// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { execute } from '../src/application.mjs';
import { runPlatformWork, loadPlatformClient } from '../src/platform.mjs';
import { setup,baseline } from './helpers.mjs';

const repo=resolve(fileURLToPath(new URL('..',import.meta.url)));
const budget=(max=100,runtime=60)=>({max_cost_microunits:max,currency:'USD',max_runtime_seconds:runtime,max_storage_bytes:4096,max_egress_bytes:4096});
const estimate=(billable=30,runtime=10)=>({billable_microunits:billable,runtime_seconds:runtime,storage_bytes:100,egress_bytes:100,confidence:'bounded'});
const measured=(billable=40,runtime=12,managed=billable)=>({billable_microunits:billable,managed_compute_microunits:managed,runtime_seconds:runtime,storage_bytes:120,egress_bytes:80});

async function prepare(app,b,{max=100,runtime=60,compute_source='platform-managed',estimated=30}={}){
  const work=(await execute(app,'work.prepare',{release_id:b.release.id,name:'RS-E2E-28 measurable work',action:'recipes.execute',
    arguments:{recipe_id:'synthetic-recipe'},budget:{max_cost_microunits:max,currency:'USD',max_runtime_seconds:runtime}})).entity;
  const reservation=(await execute(app,'usage.reserve_record',{work_id:work.id,name:'RS-E2E-28 reservation',reservation_key:'reserve-'+work.id,
    platform_reservation_id:'platform-res-'+work.id,reservation_receipt_sha256:'a'.repeat(64),reserved_cost_microunits:max,compute_source,
    budget:budget(max,runtime),estimate:estimate(estimated,Math.min(runtime,10))})).entity;
  return{work,reservation};
}
function fakeClient(app,{job='platform-job-28',throws=false}={}){
  let sends=0;
  return{
    get sends(){return sends;},
    async verifyIdentity(){return{subject:'synthetic-owner'};},
    async negotiate(){return{compatible:true};},
    prepareRequest(action,args){return{schema_version:'synthetic-platform-pending/1',action,args};},
    exportPending(record){return JSON.stringify(record);},
    async sendPrepared(){sends++;assert.equal(app.list('work').find(w=>w.data.action==='recipes.execute').data.state,'CLAIMED');if(throws)throw Error('Synthetic lost callback');return{job_id:job};},
    async recover(){return{schema_version:'semwright-platform/0.3',state:'ACCEPTED',entity_id:job,entity_kind:'job',accepted_revision:'1',related_references:[],safe_to_resubmit:false};}
  };
}
async function run(app,work,client){return runPlatformWork(app,work.id,{client,config:{budget_enforcement_confirmed:true}});}

test('RS-OPS-02 cost-bearing Platform work cannot send before one exact reservation',async t=>{
  const{app}=setup(t),b=await baseline(app);
  const work=(await execute(app,'work.prepare',{release_id:b.release.id,name:'Needs reservation',action:'recipes.execute',arguments:{recipe_id:'r'},
    budget:{max_cost_microunits:100,currency:'USD',max_runtime_seconds:60}})).entity;
  const client=fakeClient(app);
  await assert.rejects(run(app,work,client),{code:'PolicyDenied'});
  assert.equal(client.sends,0);
  const reservation=(await execute(app,'usage.reserve_record',{work_id:work.id,name:'Reservation',reservation_key:'reserve-'+work.id,
    platform_reservation_id:'platform-res-'+work.id,reservation_receipt_sha256:'a'.repeat(64),reserved_cost_microunits:100,compute_source:'platform-managed',
    budget:budget(),estimate:estimate()})).entity;
  assert.equal(reservation.data.execution_authority,false);
  await run(app,work,client);
  assert.equal(client.sends,1);
  assert.equal(app.get(work.id).data.platform_job_id,'platform-job-28');
});

test('RS-OPS-01/02 duplicate usage, adjustment and billing callbacks stay one logical record',async t=>{
  const{app}=setup(t),b=await baseline(app),artifact=(await execute(app,'deliverable.render',{id:b.deliverable.id})).entity;
  const{work,reservation}=await prepare(app,b);
  const client=fakeClient(app);
  await run(app,work,client);
  const receipt={reservation_id:reservation.id,receipt_id:'usage-28-a',platform_ledger_id:'ledger-28-a',platform_job_id:'platform-job-28',
    native_receipt_sha256:'b'.repeat(64),artifact_ids:[artifact.id],category:'compute',compute_source:'platform-managed',measured:measured(),
    observed_at:'2026-10-05T22:00:00.000Z'};
  const first=await execute(app,'usage.receipt_record',receipt),again=await execute(app,'usage.receipt_record',receipt);
  assert.equal(first.deduplicated,false);assert.equal(again.deduplicated,true);assert.equal(app.list('usage_receipt').length,1);
  const finish={id:reservation.id,expected:reservation.version,outcome:'SUCCEEDED',platform_adjustment_id:'adjust-28',
    adjustment_receipt_sha256:'c'.repeat(64)};
  const finalized=await execute(app,'usage.finalize',finish),finalizedAgain=await execute(app,'usage.finalize',finish);
  assert.equal(finalized.entity.data.released_cost_microunits,60);
  assert.equal(finalized.entity.data.measured.billable_microunits,40);
  assert.equal(finalizedAgain.deduplicated,true);
  const billing={id:reservation.id,event_id:'billing-28',invoice_id:'invoice-test-28',mode:'test',status:'SETTLED',amount_microunits:40,currency:'USD',
    platform_receipt_sha256:'d'.repeat(64),received_at:'2026-10-05T22:01:00.000Z'};
  const bill1=await execute(app,'usage.billing_record',billing),bill2=await execute(app,'usage.billing_record',billing);
  assert.equal(bill1.entity.data.live_charge,false);assert.equal(bill1.entity.data.execution_retriggered,false);assert.equal(bill2.deduplicated,true);
  const inspected=await execute(app,'usage.inspect',{id:reservation.id});
  assert.equal(inspected.receipts.length,1);assert.equal(inspected.billing_events.length,1);
  assert.equal(inspected.billing.live_charge_performed,false);
  assert.deepEqual(inspected.correlation.artifact_ids,[artifact.id]);
});

test('RS-OPS-03 BYO compute is never charged as Launchwright managed compute',async t=>{
  const{app}=setup(t),b=await baseline(app);
  const{work,reservation}=await prepare(app,b,{compute_source:'byo',estimated:5});
  await run(app,work,fakeClient(app,{job:'platform-job-byo'}));
  const base={reservation_id:reservation.id,platform_job_id:'platform-job-byo',artifact_ids:[],compute_source:'byo',observed_at:'2026-10-05T22:10:00.000Z'};
  await assert.rejects(execute(app,'usage.receipt_record',{...base,receipt_id:'bad-byo',platform_ledger_id:'ledger-bad-byo',category:'compute',measured:measured(1,1,1)}),{code:'PolicyDenied'});
  await execute(app,'usage.receipt_record',{...base,receipt_id:'byo-compute',platform_ledger_id:'ledger-byo-compute',category:'compute',measured:measured(0,4,0)});
  await execute(app,'usage.receipt_record',{...base,receipt_id:'byo-service',platform_ledger_id:'ledger-byo-service',category:'service',
    measured:{billable_microunits:5,managed_compute_microunits:0,runtime_seconds:1,storage_bytes:0,egress_bytes:0}});
  const inspected=await execute(app,'usage.inspect',{id:reservation.id});
  assert.equal(inspected.compute_source,'byo');assert.equal(inspected.byo_managed_compute_billed,false);
  assert.equal(inspected.estimate_vs_measured.measured.managed_compute_microunits,0);
  assert.equal(inspected.estimate_vs_measured.measured.billable_microunits,5);
});

test('RS-OPS-04 cancellation/unknown preserves consumed usage and releases only after reconciliation',async t=>{
  const{app}=setup(t),b=await baseline(app);
  const{work,reservation}=await prepare(app,b,{max:50,runtime:5,estimated:10});
  await run(app,work,fakeClient(app,{job:'platform-job-limit'}));
  await execute(app,'usage.receipt_record',{reservation_id:reservation.id,receipt_id:'limit-usage',platform_ledger_id:'ledger-limit',
    platform_job_id:'platform-job-limit',artifact_ids:[],category:'compute',compute_source:'platform-managed',
    measured:measured(20,6,20),observed_at:'2026-10-05T22:20:00.000Z'});
  const unknown=await execute(app,'usage.finalize',{id:reservation.id,expected:reservation.version,outcome:'OUTCOME_UNKNOWN',uncertainty_note:'Cancellation raced measured compute'});
  assert.equal(unknown.entity.data.state,'RECONCILIATION_REQUIRED');assert.equal(unknown.entity.data.released_cost_microunits,0);
  assert.ok(unknown.entity.data.limit_breaches.includes('runtime'));
  const reconciled=await execute(app,'usage.finalize',{id:reservation.id,expected:unknown.entity.version,outcome:'CANCELLED',
    platform_adjustment_id:'adjust-limit',adjustment_receipt_sha256:'e'.repeat(64),uncertainty_note:'Platform reconciled cancellation'});
  assert.equal(reconciled.entity.data.state,'FINALIZED');assert.equal(reconciled.entity.data.released_cost_microunits,30);
  assert.equal(reconciled.entity.data.measured.billable_microunits,20);
  assert.equal(reconciled.entity.data.budget_exceeded,true);
});

test('RS-OPS-05 correlation follows release to Platform job, native receipt and exact artifact without secrets',async t=>{
  const{app}=setup(t),b=await baseline(app),artifact=(await execute(app,'deliverable.render',{id:b.deliverable.id})).entity;
  const{work,reservation}=await prepare(app,b);
  await run(app,work,fakeClient(app,{job:'platform-job-correlation'}));
  await execute(app,'usage.receipt_record',{reservation_id:reservation.id,receipt_id:'corr-usage',platform_ledger_id:'ledger-correlation',
    platform_job_id:'platform-job-correlation',native_receipt_sha256:'f'.repeat(64),artifact_ids:[artifact.id],category:'render',
    compute_source:'platform-managed',measured:measured(20,5,20),observed_at:'2026-10-05T22:30:00.000Z'});
  const inspected=await execute(app,'usage.inspect',{id:reservation.id});
  assert.equal(inspected.correlation.release_id,b.release.id);assert.equal(inspected.correlation.work_id,work.id);
  assert.equal(inspected.correlation.platform_job_id,'platform-job-correlation');
  assert.deepEqual(inspected.correlation.native_receipt_sha256,['f'.repeat(64)]);
  assert.deepEqual(inspected.correlation.artifact_ids,[artifact.id]);
  assert.equal(JSON.stringify(inspected).includes('authorization'),false);
});

test('RS-OPS-06 performance phases stay separate and local fixtures cannot become production p95 claims',async t=>{
  const{app}=setup(t),b=await baseline(app),{reservation}=await prepare(app,b);
  const sample={reservation_id:reservation.id,sample_id:'perf-28',environment:{source:'local-lab',name:'Owned fixture',runner:'linux-local',code_sha:'1'.repeat(64)},
    phases:{query_ms:2,admission_ms:3,queue_ms:5,render_ms:11},measured_at:'2026-10-05T22:40:00.000Z',evidence_refs:['synthetic://perf-28']};
  const first=await execute(app,'usage.performance_record',sample),again=await execute(app,'usage.performance_record',sample);
  assert.equal(first.entity.data.production_slo_claim,false);assert.equal(first.entity.data.percentile_claim_allowed,false);assert.equal(again.deduplicated,true);
  const inspected=await execute(app,'usage.inspect',{id:reservation.id});
  assert.deepEqual(inspected.performance_samples[0].data.phases,sample.phases);
  assert.equal(inspected.performance_policy.phases_separate,true);assert.equal(inspected.performance_policy.production_slo_claim,false);
});

test('RS-OPS-07 doctor reports missing Platform inputs without initializing or installing anything',()=>{
  const root=mkdtempSync(join(tmpdir(),'launchwright-doctor-'));
  const env={...process.env};
  delete env.SEMWRIGHT_PLATFORM_SDK;delete env.SEMWRIGHT_PLATFORM_LOCK;delete env.SEMWRIGHT_PLATFORM_CONFIG;delete env.SEMWRIGHT_PLATFORM_TOKEN;
  const result=spawnSync(process.execPath,[join(repo,'src/main.mjs'),'doctor','--state',root],{cwd:repo,env,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const report=JSON.parse(result.stdout);
  assert.equal(report.doctor_mutated_system,false);assert.equal(report.platform_preflight.configured,false);
  assert.deepEqual(report.platform_preflight.missing,['SEMWRIGHT_PLATFORM_SDK','SEMWRIGHT_PLATFORM_LOCK','SEMWRIGHT_PLATFORM_CONFIG']);
  assert.match(report.platform_preflight.instruction,/never installs dependencies/);
  assert.equal(existsSync(join(root,'launchwright.sqlite3')),false);
});

test('RS-OPS-09 billing custody is test-only and a failed/duplicate callback never reruns work or mutates evidence',async t=>{
  const{app}=setup(t),b=await baseline(app),{work,reservation}=await prepare(app,b);
  const client=fakeClient(app,{job:'platform-job-billing'});await run(app,work,client);
  await execute(app,'usage.receipt_record',{reservation_id:reservation.id,receipt_id:'billing-usage',platform_ledger_id:'ledger-billing',
    platform_job_id:'platform-job-billing',artifact_ids:[],category:'service',compute_source:'platform-managed',measured:measured(10,2,0),
    observed_at:'2026-10-05T22:50:00.000Z'});
  await execute(app,'usage.finalize',{id:reservation.id,expected:reservation.version,outcome:'SUCCEEDED',platform_adjustment_id:'adjust-billing',
    adjustment_receipt_sha256:'2'.repeat(64)});
  await assert.rejects(execute(app,'usage.billing_record',{id:reservation.id,event_id:'live-denied',invoice_id:'invoice-live',mode:'live',status:'SETTLED',
    amount_microunits:10,currency:'USD',platform_receipt_sha256:'3'.repeat(64),received_at:'2026-10-05T22:51:00.000Z'}));
  const failed={id:reservation.id,event_id:'billing-failed',invoice_id:'invoice-test-failed',mode:'test',status:'FAILED',amount_microunits:10,currency:'USD',
    platform_receipt_sha256:'4'.repeat(64),received_at:'2026-10-05T22:52:00.000Z'};
  await execute(app,'usage.billing_record',failed);await execute(app,'usage.billing_record',failed);
  assert.equal(client.sends,1);assert.equal(app.list('billing_event').length,1);assert.equal(app.list('billing_event')[0].data.execution_retriggered,false);
});

test('RS-OPS-10 reviewed Platform Client loads from a clean owner-pinned directory without cookies or author paths',async()=>{
  const root=mkdtempSync(join(tmpdir(),'launchwright-platform-cleanroom-')),sdk=join(root,'sdk'),src=join(sdk,'src');
  mkdirSync(src,{recursive:true});
  const pkg='{"name":"@semwright/platform-client","version":"0.3.5-dev.1","type":"module"}\n';
  const module=`export const VERSION='0.3.5-dev.1'; export class PlatformClient { constructor(options){this.options=options;} async verifyIdentity(){return {ok:true};} async negotiate(){return {ok:true};} }`;
  writeFileSync(join(sdk,'package.json'),pkg);writeFileSync(join(src,'index.mjs'),module);
  const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
  const lock={schema_version:'launchwright-platform-sdk-lock/1',package_version:'0.3.5-dev.1',files:{'package.json':sha(join(sdk,'package.json')),'src/index.mjs':sha(join(src,'index.mjs'))}};
  const lockPath=join(root,'lock.json'),configPath=join(root,'config.json');
  writeFileSync(lockPath,JSON.stringify(lock));writeFileSync(configPath,JSON.stringify({base_url:'http://127.0.0.1:8787',identity:{tenant:'cleanroom'},allow_insecure_loopback:true,budget_enforcement_confirmed:true}));
  const env={SEMWRIGHT_PLATFORM_SDK:sdk,SEMWRIGHT_PLATFORM_LOCK:lockPath,SEMWRIGHT_PLATFORM_CONFIG:configPath,SEMWRIGHT_PLATFORM_TOKEN:'synthetic-token'};
  const{client,config}=await loadPlatformClient(env);
  assert.equal(config.identity.tenant,'cleanroom');assert.equal(client.options.baseUrl,'http://127.0.0.1:8787');
  assert.equal(Object.hasOwn(client.options,'cookie'),false);
  assert.deepEqual(await client.verifyIdentity(),{ok:true});
});
