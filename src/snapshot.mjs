// SPDX-License-Identifier: AGPL-3.0-only
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { requireCondition as ensure } from '@semwright/native-sdk';
import { Store } from './store.mjs';
import { iso } from './contracts.mjs';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sortBy = key => (a,b)=>String(a[key]).localeCompare(String(b[key]));

function migrationRows(store){
  return store.tableExists('schema_migrations')?store.db.prepare('SELECT name,applied,detail FROM schema_migrations ORDER BY name').all().map(r=>({...r,detail:JSON.parse(r.detail)})):[];
}
function historyMode(store){
  if(!store.hasHistory)return 'CURRENT_STATE_ONLY_UNMIGRATED';
  return store.db.prepare("SELECT name FROM schema_migrations WHERE name='history-v1-backfill-current'").get()?'EXACT_POST_MIGRATION_PREVIOUS_UNKNOWN':'EXACT_FROM_WORKSPACE_CREATION';
}

export function snapshotSummary(app) {
  const entityRows=app.store.db.prepare('SELECT kind,count(*) AS n FROM entities GROUP BY kind ORDER BY kind').all();
  const blobStats=app.store.db.prepare('SELECT count(*) AS count,coalesce(sum(length(content)),0) AS bytes FROM blobs').get();
  const aliasCount=app.store.db.prepare('SELECT count(*) AS n FROM aliases').get().n;
  const pending=app.store.db.prepare("SELECT work_id,state FROM pending WHERE state!='COMPLETED' ORDER BY work_id LIMIT 128").all();
  const pendingTotal=app.store.db.prepare("SELECT count(*) AS n FROM pending WHERE state!='COMPLETED'").get().n;
  const payload={
    schema_version:'launchwright-snapshot-summary/2',
    workspace_version:app.store.version(),
    domain_schema_version:app.store.meta().schema_version,
    history_ready:app.store.hasHistory,
    history_mode:historyMode(app.store),
    history_rows:app.store.hasHistory?app.store.db.prepare('SELECT count(*) AS n FROM entity_history').get().n:0,
    entity_counts:Object.fromEntries(entityRows.map(r=>[r.kind,r.n])),
    blob_count:blobStats.count,
    blob_bytes:blobStats.bytes,
    alias_count:aliasCount,
    pending_reconciliation:pending,
    pending_reconciliation_total:pendingTotal,
    pending_reconciliation_truncated:pendingTotal>pending.length,
  };
  return {...payload,digest:hash(payload)};
}

export function exportSnapshot(app) {
  const meta=app.store.meta();
  const entities=app.store.all().sort(sortBy('id'));
  const history=app.store.hasHistory?app.store.db.prepare('SELECT id,kind,generation,revision,data,created,updated,archived FROM entity_history ORDER BY id,generation,CAST(revision AS INTEGER)').all().map(r=>({...r,data:JSON.parse(r.data)})):[];
  const blobs=app.store.db.prepare('SELECT sha256,mime,content FROM blobs ORDER BY sha256').all().map(b=>({
    sha256:b.sha256,mime:b.mime,content_base64:Buffer.from(b.content).toString('base64')
  }));
  const aliases=app.store.db.prepare('SELECT name,generation,revision,candidate_id FROM aliases ORDER BY name').all();
  const pending=app.store.db.prepare('SELECT work_id,record,state FROM pending ORDER BY work_id').all().map(p=>({...p,record:JSON.parse(p.record)}));
  const events=app.store.db.prepare('SELECT seq,id,operation,principal,resource,revision,occurred,payload FROM events ORDER BY seq').all().map(e=>({...e,payload:JSON.parse(e.payload)}));
  const receipts=app.store.db.prepare('SELECT epoch,key,digest,principal,result FROM receipts ORDER BY epoch,key').all().map(r=>({...r,result:JSON.parse(r.result)}));
  const payload={
    schema_version:'launchwright-portable-snapshot/2',
    exported_at:iso(),
    source_workspace:{generation:meta.generation,revision:meta.revision,epoch:meta.epoch,schema_version:meta.schema_version},
    history_status:historyMode(app.store),
    entities,history,migrations:migrationRows(app.store),blobs,aliases,pending,events,
    historical_receipts:receipts,
    restore_policy:{
      new_workspace_generation:true,
      request_epoch_bumped:true,
      receipts_replayed:false,
      uncertain_pending_suspended:true,
      external_credentials_included:false,
      history_reconstructed:false,
    },
  };
  return {...payload,digest:hash(payload)};
}

export function restoreSnapshot(root,snapshot) {
  ensure(snapshot&&['launchwright-portable-snapshot/1','launchwright-portable-snapshot/2'].includes(snapshot.schema_version),'Unsupported snapshot schema','ProtocolMismatch');
  const {digest,...payload}=snapshot;
  ensure(typeof digest==='string'&&/^[a-f0-9]{64}$/.test(digest),'Snapshot digest missing or invalid');
  ensure(hash(payload)===digest,'Snapshot digest mismatch','Conflict');
  ensure(!existsSync(join(root,'launchwright.sqlite3')),'Restore target already contains a workspace','Conflict');
  const history=snapshot.history??[],migrations=snapshot.migrations??[];
  ensure(Array.isArray(snapshot.entities)&&Array.isArray(snapshot.blobs)&&Array.isArray(snapshot.aliases)&&Array.isArray(snapshot.pending)&&Array.isArray(snapshot.events)&&Array.isArray(history)&&Array.isArray(migrations),'Snapshot collections are invalid');
  ensure(snapshot.entities.length<=100000&&history.length<=500000&&snapshot.blobs.length<=10000&&snapshot.events.length<=500000,'Snapshot exceeds restore limits','ResourceExhausted');
  const store=new Store(root,{initialize:true});
  try {
    store.db.exec('BEGIN IMMEDIATE');
    ensure(store.db.prepare('SELECT count(*) AS n FROM entities').get().n===0,'Restore target is not empty','Conflict');
    for(const e of snapshot.entities){
      ensure(e&&typeof e.id==='string'&&typeof e.kind==='string'&&e.version&&typeof e.data==='object','Invalid snapshot entity');
      const data=structuredClone(e.data);
      if(e.kind==='work'&&['CLAIMED','OUTCOME_UNKNOWN'].includes(data.state)){
        data.state='RESTORE_RECONCILE_REQUIRED';
        data.restore_note='Restored without active request receipt; reconcile before any external retry.';
      }
      store.db.prepare('INSERT INTO entities VALUES(?,?,?,?,?,?,?)').run(e.id,e.kind,e.version.generation,e.version.revision,JSON.stringify(data),e.created,e.updated);
    }

    store.db.prepare('DELETE FROM entity_history').run();
    store.db.prepare('DELETE FROM schema_migrations').run();
    if(history.length){
      for(const h of history){
        ensure(h&&typeof h.id==='string'&&typeof h.kind==='string'&&typeof h.generation==='string'&&typeof h.revision==='string'&&/^\d+$/.test(h.revision)&&typeof h.data==='object'&&typeof h.created==='string'&&typeof h.updated==='string'&&typeof h.archived==='string','Invalid snapshot history row');
        store.db.prepare('INSERT INTO entity_history(id,kind,generation,revision,data,created,updated,archived) VALUES(?,?,?,?,?,?,?,?)').run(h.id,h.kind,h.generation,h.revision,JSON.stringify(h.data),h.created,h.updated,h.archived);
      }
      for(const m of migrations){
        ensure(m&&typeof m.name==='string'&&typeof m.applied==='string'&&m.detail&&typeof m.detail==='object','Invalid snapshot migration record');
        store.db.prepare('INSERT INTO schema_migrations(name,applied,detail) VALUES(?,?,?)').run(m.name,m.applied,JSON.stringify(m.detail));
      }
      if(!migrations.length)store.db.prepare('INSERT INTO schema_migrations(name,applied,detail) VALUES(?,?,?)').run('history-v1-restored',iso(),JSON.stringify({mode:'restored-exact-history'}));
    }else{
      const now=iso();
      for(const e of snapshot.entities)store.db.prepare('INSERT INTO entity_history(id,kind,generation,revision,data,created,updated,archived) VALUES(?,?,?,?,?,?,?,?)').run(e.id,e.kind,e.version.generation,e.version.revision,JSON.stringify(e.data),e.created,e.updated,now);
      store.db.prepare('INSERT INTO schema_migrations(name,applied,detail) VALUES(?,?,?)').run('history-v1-restore-current',now,JSON.stringify({mode:'current-state-only',pre_snapshot_history:'NOT_RECONSTRUCTED'}));
    }
    for(const e of snapshot.entities){
      const row=store.db.prepare('SELECT revision FROM entity_history WHERE id=? AND generation=? AND revision=?').get(e.id,e.version.generation,e.version.revision);
      ensure(row,'Snapshot history does not contain the current entity revision','Conflict');
    }

    for(const b of snapshot.blobs){
      ensure(b&&typeof b.sha256==='string'&&/^[a-f0-9]{64}$/.test(b.sha256)&&typeof b.mime==='string'&&typeof b.content_base64==='string','Invalid snapshot blob');
      const bytes=Buffer.from(b.content_base64,'base64');
      ensure(createHash('sha256').update(bytes).digest('hex')===b.sha256,'Snapshot blob digest mismatch','Conflict');
      store.db.prepare('INSERT INTO blobs VALUES(?,?,?)').run(b.sha256,b.mime,bytes);
    }
    for(const a of snapshot.aliases){
      ensure(a&&typeof a.name==='string'&&typeof a.candidate_id==='string','Invalid snapshot alias');
      store.db.prepare('INSERT INTO aliases VALUES(?,?,?,?)').run(a.name,randomUUID(),a.revision,a.candidate_id);
    }
    for(const p of snapshot.pending){
      ensure(p&&typeof p.work_id==='string'&&p.record&&typeof p.record==='object','Invalid snapshot pending record');
      const state=p.state==='COMPLETED'?'COMPLETED':'RESTORE_RECONCILE_REQUIRED';
      store.db.prepare('INSERT INTO pending VALUES(?,?,?)').run(p.work_id,JSON.stringify(p.record),state);
    }
    for(const e of snapshot.events){
      ensure(e&&Number.isSafeInteger(e.seq)&&typeof e.id==='string'&&typeof e.operation==='string','Invalid snapshot event');
      store.db.prepare('INSERT INTO events(seq,id,operation,principal,resource,revision,occurred,payload) VALUES(?,?,?,?,?,?,?,?)').run(e.seq,e.id,e.operation,e.principal,e.resource,e.revision,e.occurred,JSON.stringify(e.payload));
    }
    const old=snapshot.source_workspace;
    ensure(old&&typeof old.revision==='string'&&/^\d+$/.test(old.revision)&&Number.isSafeInteger(Number(old.epoch)),'Snapshot workspace metadata is invalid');
    const nextRevision=(BigInt(old.revision)+1n).toString(),nextEpoch=Number(old.epoch)+1;
    ensure(Number.isSafeInteger(nextEpoch),'Snapshot epoch cannot be advanced safely');
    store.db.prepare('UPDATE meta SET schema_version=2,generation=?,revision=?,epoch=? WHERE singleton=1').run(randomUUID(),nextRevision,nextEpoch);
    store.db.prepare('INSERT INTO events(id,operation,principal,resource,revision,occurred,payload) VALUES(?,?,?,?,?,?,?)').run(
      randomUUID(),'workspace.restore','local-admin',null,nextRevision,iso(),JSON.stringify({source_snapshot_digest:digest,source_epoch:old.epoch,active_receipts_restored:false,history_rows:store.db.prepare('SELECT count(*) AS n FROM entity_history').get().n})
    );
    store.db.exec('COMMIT');
    store.hasHistory=true;
    return {restored:true,workspace_version:store.version(),schema_version:2,source_snapshot_digest:digest,history_rows:store.db.prepare('SELECT count(*) AS n FROM entity_history').get().n,pending_reconciliation:store.db.prepare("SELECT count(*) AS n FROM pending WHERE state='RESTORE_RECONCILE_REQUIRED'").get().n};
  } catch(err) {
    try{store.db.exec('ROLLBACK');}catch{}
    throw err;
  } finally {
    store.close();
  }
}
