// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LaunchwrightApplication, execute } from '../src/application.mjs';
import { exportSnapshot, restoreSnapshot } from '../src/snapshot.mjs';
import { setup, baseline, candidate, update } from './helpers.mjs';

const verifier=(authority='heuristic')=>({id:'fixture-verifier',version:'1.0.0',digest:'a'.repeat(64),authority});

test('portable snapshot restores durable identities and bytes but disables old mutation receipts', async t => {
  const {app}=setup(t);const b=await baseline(app);const {artifact}=await candidate(app,b);
  const work=(await execute(app,'work.prepare',{release_id:b.release.id,name:'External uncertain work',action:'graph.observe',arguments:{project:'fixture'},budget:{max_cost_microunits:0,currency:'USD',max_runtime_seconds:30}})).entity;
  await execute(app,'work.claim',{id:work.id,prepared_record:{schema_version:'fixture/1',request_id:'pending'}});
  const before=app.store.version(),oldEpoch=app.store.meta().epoch,snapshot=exportSnapshot(app);
  assert.equal(snapshot.restore_policy.receipts_replayed,false);
  const root=mkdtempSync(join(tmpdir(),'launchwright-restore-'));let restored=null;t.after(()=>{try{restored?.close();}catch{}rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:50});});
  const result=restoreSnapshot(root,snapshot);
  assert.notEqual(result.workspace_version.generation,before.generation);
  restored=new LaunchwrightApplication(root);
  assert.equal(restored.get(b.release.id).data.name,b.release.data.name);
  assert.equal(restored.get(artifact.id).data.sha256,artifact.data.sha256);
  assert.equal(restored.store.readBlob(artifact.data.sha256).bytes.length,artifact.data.size_bytes);
  assert.equal(restored.get(work.id).data.state,'RESTORE_RECONCILE_REQUIRED');
  assert.equal(restored.store.db.prepare('SELECT state FROM pending WHERE work_id=?').get(work.id).state,'RESTORE_RECONCILE_REQUIRED');
  assert.equal(restored.store.db.prepare('SELECT count(*) AS n FROM receipts').get().n,0);
  assert.equal(restored.store.meta().epoch,oldEpoch+1);
  assert.ok(restored.read('events.list',{after:0,limit:128}).items.some(e=>e.operation==='workspace.restore'));
});

test('snapshot digest rejects modified portable content', async t => {
  const {app}=setup(t);await baseline(app);const snapshot=exportSnapshot(app);
  snapshot.entities[0].data.name='tampered';
  const root=mkdtempSync(join(tmpdir(),'launchwright-restore-bad-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  assert.throws(()=>restoreSnapshot(root,snapshot),{code:'Conflict'});
});

test('capture receipts preserve provenance without manufacturing technical PASS', async t => {
  const {app}=setup(t);const b=await baseline(app);
  const source=(await update(app,b.source,{approval:'approved',purpose:'Owned local capture fixture'})).entity;
  const scenario=await b.create('scenario',{release_id:b.release.id,name:'Open owned fixture',source_id:source.id,target_id:b.target.id,steps:[{action:'navigate',anchor:'root'}],anchors:[{name:'root',role:'main',label:'Owned fixture',expected_count:1}],readiness:'declared',version_label:'1',reset_strategy:'isolated-context'});
  const receipt={release_id:b.release.id,target_id:b.target.id,source_id:source.id,scenario_id:scenario.id,name:'Owned capture receipt',build:'build-A',classification:'demo',rights:'owned',started_at:'2026-10-04T20:00:00.000Z',finished_at:'2026-10-04T20:00:01.000Z',receipt:{authority:'semwright-native-driver',provider:'browser',provider_version:'fixture',operation_id:'op-1',profile:'owned-browser',build_observation:'build-A',outcome:'SUCCEEDED'},observations:[{kind:'anchor',key:'root',value:'1 match',source:'accessible'}]};
  const evidence=(await execute(app,'capture.ingest',receipt)).entity;
  assert.equal(evidence.data.evidence_type,'capture');
  assert.equal(evidence.data.capture_state,'SUCCEEDED');
  assert.equal(evidence.data.technical,'UNKNOWN');
  assert.equal(evidence.data.host_acceptance,'NOT_ESTABLISHED');
  assert.equal(evidence.data.admission,'semwright-receipt-recorded');
  await assert.rejects(execute(app,'capture.ingest',{...receipt,name:'Wrong build',build:'build-B'}),{code:'Conflict'});
});

test('capture execution requires an explicitly approved source', async t => {
  const {app}=setup(t);const b=await baseline(app);
  const scenario=await b.create('scenario',{release_id:b.release.id,name:'Declared only',source_id:b.source.id,target_id:b.target.id,steps:[],anchors:[],readiness:'declared'});
  await assert.rejects(execute(app,'capture.ingest',{release_id:b.release.id,target_id:b.target.id,source_id:b.source.id,scenario_id:scenario.id,name:'Not authorized',build:'build-A',classification:'demo',rights:'owned',started_at:'2026-10-04T20:00:00.000Z',finished_at:'2026-10-04T20:00:01.000Z',receipt:{authority:'semwright-native-driver',provider:'browser',provider_version:'fixture',operation_id:'op-2',profile:'owned-browser',outcome:'SUCCEEDED'},observations:[]}),{code:'PermissionDenied'});
});

test('heuristic PASS remains UNKNOWN and a waiver preserves a recorded failure', async t => {
  const {app}=setup(t);const b=await baseline(app),{artifact,candidate:c}=await candidate(app,b);
  const common={candidate_id:c.id,dimension:'semantic',artifact_ids:[artifact.id],coverage:{checked:1,total:1},omissions:[],findings:[],observed_at:'2026-10-04T20:00:00.000Z'};
  const heuristic=(await execute(app,'verification.record',{...common,state:'PASS',verifier:verifier('heuristic')})).entity;
  let summary=await execute(app,'verification.summary',{candidate_id:c.id});
  assert.equal(summary.state,'UNKNOWN');assert.equal(summary.checks[0].reported_state,'PASS');assert.equal(summary.checks[0].effective_state,'UNKNOWN');
  await assert.rejects(execute(app,'verification.record',{...common,state:'PASS',verifier:verifier('canonical')}),{code:'PolicyDenied'});
  const failed=(await execute(app,'verification.record',{...common,dimension:'privacy',state:'FAIL',verifier:verifier('independent'),findings:[{code:'CANARY',severity:'blocker',message:'Synthetic negative control'}]})).entity;
  const waiver=(await execute(app,'waiver.record',{candidate_id:c.id,verification_id:failed.id,reason:'Synthetic exception for review only',scope:'private-draft',expires_at:'2099-01-01T00:00:00.000Z'})).entity;
  assert.equal(waiver.data.changes_verification_state,false);
  summary=await execute(app,'verification.summary',{candidate_id:c.id});
  assert.equal(summary.state,'FAIL');assert.equal(summary.checks.find(x=>x.verification_id===failed.id).waived,true);
  assert.equal(app.inspectCandidate(c).technical_state,'FAIL');
  assert.equal(heuristic.kind,'verification');
});

test('canonical verifier PASS is only admitted behind the explicit owner capability', async t => {
  const {app}=setup(t,{capabilities:{canonical_verifier_admission:true}});const b=await baseline(app),{artifact,candidate:c}=await candidate(app,b);
  await execute(app,'verification.record',{candidate_id:c.id,dimension:'format',state:'PASS',verifier:verifier('canonical'),artifact_ids:[artifact.id],coverage:{checked:1,total:1},omissions:[],findings:[],observed_at:'2026-10-04T20:00:00.000Z'});
  const summary=await execute(app,'verification.summary',{candidate_id:c.id});
  assert.equal(summary.state,'PASS');assert.equal(summary.canonical_passes,1);
});

test('channel packaging freezes exact bytes separately from external delivery state', async t => {
  const {app}=setup(t);const b=await baseline(app),{candidate:c}=await candidate(app,b);
  const profile=await b.create('channel_profile',{product_id:b.product.id,name:'Docs review portal',channel:'docs-review',profile_version:'2026-10-04',destination_class:'external-draft',requirements:{format:'json'},source:'operator-contract:docs-review',effective_at:'2026-10-04T00:00:00.000Z',idempotency:'recover-first'});
  const packaged=(await execute(app,'channel.package',{candidate_id:c.id,profile_id:profile.id,participant:'reviewer-a',locale:'en-US',allow_partial:false,omissions:[]})).entity;
  assert.equal(packaged.data.state,'PACKAGE_READY');assert.equal(packaged.data.external_state,'NOT_SENT');
  const bytes=app.store.readBlob(packaged.data.package_sha256).bytes;
  const manifest=JSON.parse(bytes.toString());
  assert.equal(manifest.candidate_sha256,c.data.candidate_sha256);assert.equal(manifest.profile.profile_version,profile.data.profile_version);
  await assert.rejects(execute(app,'channel.record_outcome',{delivery_id:packaged.id,state:'UPLOADED',observed_at:'2026-10-04T20:02:00.000Z'}),{code:'InvalidArgument'});
  const unknown=(await execute(app,'channel.record_outcome',{delivery_id:packaged.id,state:'UNKNOWN',observed_at:'2026-10-04T20:02:00.000Z',message:'Synthetic lost ACK'})).entity;
  assert.equal(unknown.data.recovery_required,true);assert.equal(unknown.data.retry_policy,'RECOVER_BEFORE_RETRY');
  await assert.rejects(execute(app,'channel.record_outcome',{delivery_id:packaged.id,state:'PUBLISHED',receipt_digest:'b'.repeat(64),observed_at:'2026-10-04T20:03:00.000Z'}),{code:'PolicyDenied'});
  const status=await execute(app,'channel.status',{release_id:b.release.id});
  assert.equal(status.latest.length,1);assert.equal(status.latest[0].id,unknown.id);assert.equal(status.external_send_performed,false);
});
