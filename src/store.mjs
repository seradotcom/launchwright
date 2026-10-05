// SPDX-License-Identifier: AGPL-3.0-only
import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync, existsSync, lstatSync, chmodSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { NativeError, requireCondition as ensure, sameVersion, validateValue } from '@semwright/native-sdk';
import { RESOURCE, iso } from './contracts.mjs';
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
      this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
        CREATE TABLE IF NOT EXISTS meta (singleton INTEGER PRIMARY KEY CHECK(singleton=1), schema_version INTEGER NOT NULL, generation TEXT NOT NULL, revision TEXT NOT NULL, epoch INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS entities (id TEXT PRIMARY KEY, kind TEXT NOT NULL, generation TEXT NOT NULL, revision TEXT NOT NULL, data TEXT NOT NULL, created TEXT NOT NULL, updated TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS entity_kind ON entities(kind,id);
        CREATE TABLE IF NOT EXISTS receipts (epoch INTEGER NOT NULL, key TEXT NOT NULL, digest TEXT NOT NULL, principal TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(epoch,key));
        CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, operation TEXT NOT NULL, principal TEXT NOT NULL, resource TEXT, revision TEXT NOT NULL, occurred TEXT NOT NULL, payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS blobs (sha256 TEXT PRIMARY KEY, mime TEXT NOT NULL, content BLOB NOT NULL);
        CREATE TABLE IF NOT EXISTS aliases (name TEXT PRIMARY KEY, generation TEXT NOT NULL, revision TEXT NOT NULL, candidate_id TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS pending (work_id TEXT PRIMARY KEY, record TEXT NOT NULL, state TEXT NOT NULL);
      `);
      this.db.prepare('INSERT OR IGNORE INTO meta VALUES(1,1,?,?,0)').run(randomUUID(), '9007199254740993');
      try { chmodSync(file,0o600); } catch { /* ACL differs on Windows; doctor reports platform. */ }
    }
    ensure(this.db.prepare('SELECT schema_version FROM meta WHERE singleton=1').get()?.schema_version === 1, 'Unsupported database schema; never migrate implicitly', 'ProtocolMismatch');
  }
  close() { this.db.close(); }
  meta() { return this.db.prepare('SELECT * FROM meta WHERE singleton=1').get(); }
  version() { const m = this.meta(); return { resource:RESOURCE,generation:m.generation,revision:m.revision }; }
  get(id) { const r = this.db.prepare('SELECT * FROM entities WHERE id=?').get(id); ensure(r, 'Resource not found', 'NotFound'); return this.decode(r); }
  decode(r) { return { id:r.id, kind:r.kind, version:{resource:r.id,generation:r.generation,revision:r.revision},data:JSON.parse(r.data),created:r.created,updated:r.updated }; }
  all(kind = 'all') { return (kind === 'all' ? this.db.prepare('SELECT * FROM entities ORDER BY id').all() : this.db.prepare('SELECT * FROM entities WHERE kind=? ORDER BY id').all(kind)).map(r => this.decode(r)); }
  create(kind,data) { const id = `${kind}_${randomUUID()}`; const now=iso(); validateValue(data); this.db.prepare('INSERT INTO entities VALUES(?,?,?,?,?,?,?)').run(id,kind,randomUUID(),'1',JSON.stringify(data),now,now); return this.get(id); }
  update(id,data) { const old = this.get(id); validateValue(data); this.db.prepare('UPDATE entities SET data=?,revision=?,updated=? WHERE id=?').run(JSON.stringify(data),(BigInt(old.version.revision)+1n).toString(),iso(),id); return this.get(id); }
  blob(bytes,mime) { ensure(bytes.length <= 1024*1024, 'Artifact exceeds local text export budget','ResourceExhausted'); const hash=createHash('sha256').update(bytes).digest('hex'); this.db.prepare('INSERT OR IGNORE INTO blobs VALUES(?,?,?)').run(hash,mime,bytes); return hash; }
  readBlob(hash) { const r=this.db.prepare('SELECT mime,content FROM blobs WHERE sha256=?').get(hash); ensure(r,'Artifact bytes not available','NotFound'); const bytes=Buffer.from(r.content); ensure(createHash('sha256').update(bytes).digest('hex')===hash,'Artifact integrity check failed','Conflict'); return {bytes,mime:r.mime}; }
  transaction(operation,principal,request,expected,mutate) {
    ensure(!this.readOnly,'Read-only workspace','PermissionDenied');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const m=this.meta();
      const prior=this.db.prepare('SELECT * FROM receipts WHERE epoch=? AND key=?').get(request.epoch,request.key);
      if (prior) { ensure(prior.digest===request.request_sha256 && prior.principal===principal, 'Request identity was already bound to another intent or principal','Conflict'); this.db.exec('COMMIT'); return JSON.parse(prior.result); }
      ensure(request.epoch===m.epoch,'Request retention epoch changed; do not resend old intent','Conflict');
      ensure(expected && sameVersion(expected,this.version()),'Workspace revision changed; observe and prepare a new intent','StaleReference');
      const output=mutate();
      // Validation before COMMIT prevents results that cannot pass the Native SDK reply budget.
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
