// SPDX-License-Identifier: AGPL-3.0-only
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { requireCondition as ensure } from '@semwright/native-sdk';
import { Store } from './store.mjs';
import { iso } from './contracts.mjs';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sortBy = key => (a,b)=>String(a[key]).localeCompare(String(b[key]));

export function snapshotSummary(app) {
  const entityRows=app.store.db.prepare('SELECT kind,count(*) AS n FROM entities GROUP BY kind ORDER BY kind').all();
  const blobStats=app.store.db.prepare('SELECT count(*) AS count,coalesce(sum(length(content)),0) AS bytes FROM blobs').get();
  const aliasCount=app.store.db.prepare('SELECT count(*) AS n FROM aliases').get().n;
  const pending=app.store.db.prepare("SELECT work_id,state FROM pending WHERE state!='COMPLETED' ORDER BY work_id LIMIT 128").all();
  const pendingTotal=app.store.db.prepare("SELECT count(*) AS n FROM pending WHERE state!='COMPLETED'").get().n;
  const payload={
    schema_version:'launchwright-snapshot-summary/1',
    workspace_version:app.store.version(),
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
  const blobs=app.store.db.prepare('SELECT sha256,mime,content FROM blobs ORDER BY sha256').all().map(b=>({
    sha256:b.sha256,mime:b.mime,content_base64:Buffer.from(b.content).toString('base64')
  }));
  const aliases=app.store.db.prepare('SELECT name,generation,revision,candidate_id FROM aliases ORDER BY name').all();
  const pending=app.store.db.prepare('SELECT work_id,record,state FROM pending ORDER BY work_id').all().map(p=>({...p,record:JSON.parse(p.record)}));
  const events=app.store.db.prepare('SELECT seq,id,operation,principal,resource,revision,occurred,payload FROM events ORDER BY seq').all().map(e=>({...e,payload:JSON.parse(e.payload)}));
  const receipts=app.store.db.prepare('SELECT epoch,key,digest,principal,result FROM receipts ORDER BY epoch,key').all().map(r=>({...r,result:JSON.parse(r.result)}));
  const payload={
    schema_version:'launchwright-portable-snapshot/1',
    exported_at:iso(),
    source_workspace:{generation:meta.generation,revision:meta.revision,epoch:meta.epoch,schema_version:meta.schema_version},
    entities,blobs,aliases,pending,events,
    historical_receipts:receipts,
    restore_policy:{
      new_workspace_generation:true,
      request_epoch_bumped:true,
      receipts_replayed:false,
      uncertain_pending_suspended:true,
      external_credentials_included:false,
    },
  };
  return {...payload,digest:hash(payload)};
}

export function restoreSnapshot(root,snapshot) {
  ensure(snapshot && snapshot.schema_version==='launchwright-portable-snapshot/1','Unsupported snapshot schema','ProtocolMismatch');
  const {digest,...payload}=snapshot;
  ensure(typeof digest==='string'&&/^[a-f0-9]{64}$/.test(digest),'Snapshot digest missing or invalid');
  ensure(hash(payload)===digest,'Snapshot digest mismatch','Conflict');
  ensure(!existsSync(join(root,'launchwright.sqlite3')),'Restore target already contains a workspace','Conflict');
  ensure(Array.isArray(snapshot.entities)&&Array.isArray(snapshot.blobs)&&Array.isArray(snapshot.aliases)&&Array.isArray(snapshot.pending)&&Array.isArray(snapshot.events),'Snapshot collections are invalid');
  ensure(snapshot.entities.length<=100000&&snapshot.blobs.length<=10000&&snapshot.events.length<=500000,'Snapshot exceeds restore limits','ResourceExhausted');
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
    const nextRevision=(BigInt(old.revision)+1n).toString();
    const nextEpoch=Number(old.epoch)+1;
    ensure(Number.isSafeInteger(nextEpoch),'Snapshot epoch cannot be advanced safely');
    store.db.prepare('UPDATE meta SET generation=?,revision=?,epoch=? WHERE singleton=1').run(randomUUID(),nextRevision,nextEpoch);
    store.db.prepare('INSERT INTO events(id,operation,principal,resource,revision,occurred,payload) VALUES(?,?,?,?,?,?,?)').run(
      randomUUID(),'workspace.restore','local-admin',null,nextRevision,iso(),JSON.stringify({source_snapshot_digest:digest,source_epoch:old.epoch,active_receipts_restored:false})
    );
    store.db.exec('COMMIT');
    return {restored:true,workspace_version:store.version(),source_snapshot_digest:digest,pending_reconciliation:store.db.prepare("SELECT count(*) AS n FROM pending WHERE state='RESTORE_RECONCILE_REQUIRED'").get().n};
  } catch(err) {
    try{store.db.exec('ROLLBACK');}catch{}
    throw err;
  } finally {
    store.close();
  }
}
