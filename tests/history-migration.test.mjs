// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { rmSync } from 'node:fs';
import { LaunchwrightApplication, execute } from '../src/application.mjs';
import { CoreNativeApplication } from '../src/native-core-app.mjs';
import { exportSnapshot, restoreSnapshot } from '../src/snapshot.mjs';
import { setup, baseline, update } from './helpers.mjs';

test('durable history stores exact entity revisions and computes bounded diffs', async t=>{
  const {app}=setup(t),b=await baseline(app);
  let product=(await update(app,b.product,{description:'Revision two'})).entity;
  product=(await update(app,product,{description:'Revision three'})).entity;
  const page=await execute(app,'history.list',{id:product.id,limit:2});
  assert.deepEqual(page.items.map(v=>v.entity.version.revision),['1','2']);
  assert.equal(page.complete,false);
  assert.equal(page.next_after,'2');
  const second=await execute(app,'history.list',{id:product.id,after_revision:page.next_after,limit:2});
  assert.deepEqual(second.items.map(v=>v.entity.version.revision),['3']);
  assert.equal(second.complete,true);
  const exact=await execute(app,'history.get',{id:product.id,revision:'2'});
  assert.equal(exact.entity.data.description,'Revision two');
  const diff=await execute(app,'history.diff',{id:product.id,from_revision:'1',to_revision:'3'});
  assert.deepEqual(diff.changed_fields,['description']);
  assert.equal(diff.before.description,'Owned test data');
  assert.equal(diff.after.description,'Revision three');
});

test('portable snapshot v2 preserves exact revision history and keeps old receipts inactive', async t=>{
  const {app,root}=setup(t),b=await baseline(app);
  const product=(await update(app,b.product,{description:'Snapshot revision'})).entity;
  const snapshot=exportSnapshot(app);
  assert.equal(snapshot.schema_version,'launchwright-portable-snapshot/2');
  assert.ok(snapshot.history.some(h=>h.id===product.id&&h.revision==='1'));
  assert.ok(snapshot.history.some(h=>h.id===product.id&&h.revision==='2'));
  const restored=join(dirname(root),'launchwright-history-restore-'+randomUUID());
  const result=restoreSnapshot(restored,snapshot);
  assert.ok(result.history_rows>=snapshot.entities.length);
  const reopened=new LaunchwrightApplication(restored,{readOnly:true});
  t.after(()=>{try{reopened.close();}finally{rmSync(restored,{recursive:true,force:true,maxRetries:8,retryDelay:50});}});
  const history=await execute(reopened,'history.list',{id:product.id});
  assert.deepEqual(history.items.map(v=>v.entity.version.revision),['1','2']);
  assert.equal(reopened.store.db.prepare('SELECT count(*) AS n FROM receipts').get().n,0);
});

test('snapshot v1 restore keeps only known current revisions and never fabricates history', async t=>{
  const {app,root}=setup(t),b=await baseline(app);
  const product=(await update(app,b.product,{description:'Only current v1 state survives'})).entity;
  const v2=exportSnapshot(app);
  const restore_policy={new_workspace_generation:true,request_epoch_bumped:true,receipts_replayed:false,uncertain_pending_suspended:true,external_credentials_included:false};
  const payload={schema_version:'launchwright-portable-snapshot/1',exported_at:v2.exported_at,source_workspace:v2.source_workspace,entities:v2.entities,blobs:v2.blobs,aliases:v2.aliases,pending:v2.pending,events:v2.events,historical_receipts:v2.historical_receipts,restore_policy};
  const snapshot={...payload,digest:createHash('sha256').update(JSON.stringify(payload)).digest('hex')};
  const restored=join(dirname(root),'launchwright-v1-restore-'+randomUUID());
  restoreSnapshot(restored,snapshot);
  const reopened=new LaunchwrightApplication(restored,{readOnly:true});
  t.after(()=>{try{reopened.close();}finally{rmSync(restored,{recursive:true,force:true,maxRetries:8,retryDelay:50});}});
  const history=await execute(reopened,'history.list',{id:product.id});
  assert.deepEqual(history.items.map(v=>v.entity.version.revision),['2']);
  assert.ok(reopened.store.db.prepare("SELECT name FROM schema_migrations WHERE name='history-v1-restore-current'").get());
  await assert.rejects(execute(reopened,'history.get',{id:product.id,revision:'1'}),err=>err?.code==='NotFound');
});

test('legacy migration backfills only the current revision and blocks mutation until explicit migration', async t=>{
  const {app}=setup(t),b=await baseline(app);
  const current=(await update(app,b.product,{description:'Known current state before legacy simulation'})).entity;
  app.store.db.exec('DROP TABLE entity_history; DROP TABLE schema_migrations; UPDATE meta SET schema_version=1;');
  app.store.hasHistory=false;
  await assert.rejects(update(app,current,{description:'Must not write before migration'}),err=>err?.code==='ProtocolMismatch');
  const migration=app.store.installHistory();
  assert.equal(migration.installed,true);
  assert.equal(migration.pre_migration_history,'NOT_RECONSTRUCTED');
  const backfilled=await execute(app,'history.list',{id:current.id});
  assert.deepEqual(backfilled.items.map(v=>v.entity.version.revision),['2']);
  const changed=(await update(app,current,{description:'First post-migration edit'})).entity;
  const after=await execute(app,'history.list',{id:changed.id});
  assert.deepEqual(after.items.map(v=>v.entity.version.revision),['2','3']);
  await assert.rejects(execute(app,'history.get',{id:changed.id,revision:'1'}),err=>err?.code==='NotFound');
});

test('core Native profile exposes the same history records as the full application', async t=>{
  const {app,root}=setup(t),b=await baseline(app);
  const product=(await update(app,b.product,{description:'Native history'})).entity;
  const core=new CoreNativeApplication(root,{readOnly:true});
  t.after(()=>core.close());
  const result=core.read('history.get',{id:product.id,revision:'2'});
  assert.deepEqual(result.entity.version,product.version);
  assert.equal(result.entity.data.description,'Native history');
});
