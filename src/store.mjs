// SPDX-License-Identifier: AGPL-3.0-only
import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync, existsSync, lstatSync, chmodSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { NativeError, requireCondition as ensure, sameVersion, validateValue } from '@semwright/native-sdk';
import { RESOURCE, iso } from './base.mjs';

const LATEST_SCHEMA=2;

export class Store {
  constructor(root, { readOnly = false, initialize = false } = {}) {
    this.root = resolve(root); this.readOnly = readOnly;
    if (initialize) { mkdirSync(this.root, { recursive:true, mode:0o700 }); ensure(!lstatSync(this.root).isSymbolicLink(), 'State directory must not be a symlink'); }
    ensure(existsSync(this.root), 'Run launchwright init before opening this workspace', 'Unavailable');
    ensure(!lstatSync(this.root).isSymbolicLink(), 'State directory must not be a symlink');
    const file = join(this.root, 'launchwright.sqlite3');
    if (existsSync(file)) ensure(!lstatSync(file).isSymbolicLink(), 'Database must not be a symlink');
    ensure(initialize || existsSync(file), 'Workspace database has not been initialized', 'Unavailable');
    this.db = new DatabaseSync(file, { readOnly, timeout:5000 });
    this.db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    if (initialize) {
      this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS meta (singleton INTEGER PRIMARY KEY CHECK(singleton=1), schema_version INTEGER NOT NULL, generation TEXT NOT NULL, revision TEXT NOT NULL, epoch INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS entities (id TEXT PRIMARY KEY, kind TEXT NOT NULL, generation TEXT NOT NULL, revision TEXT NOT NULL, data TEXT NOT NULL, created TEXT NOT NULL, updated TEXT NOT NULL); CREATE INDEX IF NOT EXISTS entity_kind ON entities(kind,id); CREATE TABLE IF NOT EXISTS entity_history (id TEXT NOT NULL, kind TEXT NOT NULL, generation TEXT NOT NULL, revision TEXT NOT NULL, data TEXT NOT NULL, created TEXT NOT NULL, updated TEXT NOT NULL, archived TEXT NOT NULL, PRIMARY KEY(id,generation,revision)); CREATE INDEX IF NOT EXISTS entity_history_lookup ON entity_history(id,generation,CAST(revision AS INTEGER)); CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied TEXT NOT NULL, detail TEXT NOT NULL); CREATE TABLE IF NOT EXISTS receipts (epoch INTEGER NOT NULL, key TEXT NOT NULL, digest TEXT NOT NULL, principal TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(epoch,key)); CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, operation TEXT NOT NULL, principal TEXT NOT NULL, resource TEXT, revision TEXT NOT NULL, occurred TEXT NOT NULL, payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS blobs (sha256 TEXT PRIMARY KEY, mime TEXT NOT NULL, content BLOB NOT NULL); CREATE TABLE IF NOT EXISTS aliases (name TEXT PRIMARY KEY, generation TEXT NOT NULL, revision TEXT NOT NULL, candidate_id TEXT NOT NULL); CREATE TABLE IF NOT EXISTS pending (work_id TEXT PRIMARY KEY, record TEXT NOT NULL, state TEXT NOT NULL);');
      const now=iso();
      this.db.prepare('INSERT OR IGNORE INTO meta VALUES(1,?,?,?,0)').run(LATEST_SCHEMA,randomUUID(),'9007199254740993');
      const schema=this.db.prepare('SELECT schema_version FROM meta WHERE singleton=1').get()?.schema_version;
      if(schema===LATEST_SCHEMA)this.db.prepare('INSERT OR IGNORE INTO schema_migrations(name,applied,detail) VALUES(?,?,?)').run('history-v1-initial',now,JSON.stringify({mode:'from-workspace-creation'}));
      try { chmodSync(file,0o600); } catch { /* ACL differs on Windows; doctor reports platform. */ }
    }
    const schema=this.db.prepare('SELECT schema_version FROM meta WHERE singleton=1').get()?.schema_version;
    ensure(schema===1||schema===LATEST_SCHEMA, 'Unsupported database schema; never migrate implicitly', 'ProtocolMismatch');
    this.hasHistory=schema===LATEST_SCHEMA&&this.tableExists('entity_history');
    if(schema===LATEST_SCHEMA)ensure(this.hasHistory,'Database declares history schema but the history table is missing','ProtocolMismatch');
  }
  tableExists(name){return !!this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);}
  close() { this.db.close(); }
  meta() { return this.db.prepare('SELECT * FROM meta WHERE singleton=1').get(); }
  version() { const m = this.meta(); return { resource:RESOURCE,generation:m.generation,revision:m.revision }; }
  get(id) { const r = this.db.prepare('SELECT * FROM entities WHERE id=?').get(id); ensure(r, 'Resource not found', 'NotFound'); return this.decode(r); }
  decode(r) { return { id:r.id, kind:r.kind, version:{resource:r.id,generation:r.generation,revision:r.revision},data:typeof r.data==='string'?JSON.parse(r.data):r.data,created:r.created,updated:r.updated }; }
  all(kind = 'all') { return (kind === 'all' ? this.db.prepare('SELECT * FROM entities ORDER BY id').all() : this.db.prepare('SELECT * FROM entities WHERE kind=? ORDER BY id').all(kind)).map(r => this.decode(r)); }
  archive(entity,archived=iso()) {
    ensure(this.hasHistory,'Workspace history is not installed; run migrate-history before mutation','ProtocolMismatch');
    this.db.prepare('INSERT OR IGNORE INTO entity_history(id,kind,generation,revision,data,created,updated,archived) VALUES(?,?,?,?,?,?,?,?)').run(entity.id,entity.kind,entity.version.generation,entity.version.revision,JSON.stringify(entity.data),entity.created,entity.updated,archived);
  }
  create(kind,data) {
    const id = `${kind}_${randomUUID()}`; const now=iso(); validateValue(data);
    this.db.prepare('INSERT INTO entities VALUES(?,?,?,?,?,?,?)').run(id,kind,randomUUID(),'1',JSON.stringify(data),now,now);
    const entity=this.get(id);this.archive(entity,now);return entity;
  }
  update(id,data) {
    const old = this.get(id); validateValue(data); const now=iso();
    this.db.prepare('UPDATE entities SET data=?,revision=?,updated=? WHERE id=?').run(JSON.stringify(data),(BigInt(old.version.revision)+1n).toString(),now,id);
    const entity=this.get(id);this.archive(entity,now);return entity;
  }
  retire(id,data) {
    const old=this.get(id); validateValue(data); const now=iso();
    this.db.prepare('UPDATE entities SET kind=?,data=?,revision=?,updated=? WHERE id=?').run('tombstone',JSON.stringify(data),(BigInt(old.version.revision)+1n).toString(),now,id);
    const entity=this.get(id);this.archive(entity,now);return entity;
  }
  installHistory() {
    ensure(!this.readOnly,'Read-only workspace','PermissionDenied');
    const schema=this.meta().schema_version;
    if(schema===LATEST_SCHEMA)return{installed:false,schema_version:LATEST_SCHEMA,history_ready:true,pre_migration_history:this.db.prepare("SELECT name FROM schema_migrations WHERE name='history-v1-backfill-current'").get()?'NOT_RECONSTRUCTED':'COMPLETE_FROM_WORKSPACE_CREATION'};
    ensure(schema===1,'Unsupported migration source schema','ProtocolMismatch');
    this.db.exec('BEGIN IMMEDIATE');
    try{
      this.db.exec('CREATE TABLE entity_history (id TEXT NOT NULL, kind TEXT NOT NULL, generation TEXT NOT NULL, revision TEXT NOT NULL, data TEXT NOT NULL, created TEXT NOT NULL, updated TEXT NOT NULL, archived TEXT NOT NULL, PRIMARY KEY(id,generation,revision)); CREATE INDEX entity_history_lookup ON entity_history(id,generation,CAST(revision AS INTEGER)); CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied TEXT NOT NULL, detail TEXT NOT NULL);');
      const now=iso(),rows=this.db.prepare('SELECT * FROM entities ORDER BY id').all();
      for(const r of rows)this.db.prepare('INSERT INTO entity_history(id,kind,generation,revision,data,created,updated,archived) VALUES(?,?,?,?,?,?,?,?)').run(r.id,r.kind,r.generation,r.revision,r.data,r.created,r.updated,now);
      const current=this.meta(),revision=(BigInt(current.revision)+1n).toString();
      this.db.prepare('UPDATE meta SET schema_version=?,revision=? WHERE singleton=1').run(LATEST_SCHEMA,revision);
      this.db.prepare('INSERT INTO schema_migrations(name,applied,detail) VALUES(?,?,?)').run('history-v1-backfill-current',now,JSON.stringify({mode:'current-state-only',entities:rows.length,pre_migration_history:'NOT_RECONSTRUCTED'}));
      this.db.prepare('INSERT INTO events(id,operation,principal,resource,revision,occurred,payload) VALUES(?,?,?,?,?,?,?)').run(randomUUID(),'workspace.migrate-history','local-admin',null,revision,now,JSON.stringify({from_schema:1,to_schema:LATEST_SCHEMA,backfilled_entities:rows.length,pre_migration_history:'NOT_RECONSTRUCTED'}));
      this.db.exec('COMMIT');this.hasHistory=true;
      return{installed:true,schema_version:LATEST_SCHEMA,history_ready:true,backfilled_entities:rows.length,pre_migration_history:'NOT_RECONSTRUCTED',workspace_version:this.version()};
    }catch(err){try{this.db.exec('ROLLBACK');}catch{}throw err;}
  }
  blob(bytes,mime) { ensure(bytes.length <= 1024*1024, 'Artifact exceeds local text export budget','ResourceExhausted'); const hash=createHash('sha256').update(bytes).digest('hex'); this.db.prepare('INSERT OR IGNORE INTO blobs VALUES(?,?,?)').run(hash,mime,bytes); return hash; }
  readBlob(hash) { const r=this.db.prepare('SELECT mime,content FROM blobs WHERE sha256=?').get(hash); ensure(r,'Artifact bytes not available','NotFound'); const bytes=Buffer.from(r.content); ensure(createHash('sha256').update(bytes).digest('hex')===hash,'Artifact integrity check failed','Conflict'); return {bytes,mime:r.mime}; }
  transaction(operation,principal,request,expected,mutate) {
    ensure(!this.readOnly,'Read-only workspace','PermissionDenied');
    ensure(this.hasHistory,'Workspace schema requires explicit migrate-history before mutation','ProtocolMismatch');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const m=this.meta();
      const prior=this.db.prepare('SELECT * FROM receipts WHERE epoch=? AND key=?').get(request.epoch,request.key);
      if (prior) { ensure(prior.digest===request.request_sha256 && prior.principal===principal, 'Request identity was already bound to another intent or principal','Conflict'); this.db.exec('COMMIT'); return JSON.parse(prior.result); }
      ensure(request.epoch===m.epoch,'Request retention epoch changed; do not resend old intent','Conflict');
      ensure(expected && sameVersion(expected,this.version()),'Workspace revision changed; observe and prepare a new intent','StaleReference');
      const output=mutate();
      const revision=(BigInt(m.revision)+1n).toString();
      this.db.prepare('UPDATE meta SET revision=? WHERE singleton=1').run(revision);
      const result={...output,workspace_version:this.version()}; validateValue(result);
      const count=this.db.prepare('SELECT count(*) AS n FROM receipts WHERE epoch=?').get(m.epoch).n;
      ensure(count < 20000,'Receipt epoch full; rotate explicitly before another mutation','ResourceExhausted');
      this.db.prepare('INSERT INTO receipts VALUES(?,?,?,?,?)').run(request.epoch,request.key,request.request_sha256,principal,JSON.stringify(result));
      this.db.prepare('INSERT INTO events(id,operation,principal,resource,revision,occurred,payload) VALUES(?,?,?,?,?,?,?)').run(randomUUID(),operation,principal,output.entity?.id??null,revision,iso(),JSON.stringify({request_key:request.key,request_sha256:request.request_sha256}));
      this.db.exec('COMMIT'); return result;
    } catch(err) { try { this.db.exec('ROLLBACK'); } catch {} if (err instanceof NativeError) throw err; throw new NativeError('BackendFailed','Application transaction failed; no confirmed commit',false); }
  }
}
