// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { LaunchwrightApplication, execute } from '../src/application.mjs';
import { setup, baseline, candidate } from './helpers.mjs';

async function prepareWork(app,releaseId,{cost=1000,runtime=60}={}){
  return(await execute(app,'work.prepare',{
    release_id:releaseId,name:'Synthetic metered work',action:'graph.observe',
    arguments:{project_id:'synthetic-project'},
    budget:{max_cost_microunits:cost,currency:'USD',max_runtime_seconds:runtime}
  })).entity;
}
async function completeWork(app,work,jobId='job-ops-1'){
  const claimed=await execute(app,'work.claim',{id:work.id,prepared_record:{schema_version:'test-pending/1',work_id:work.id}});
  return(await execute(app,'work.complete',{id:work.id,result:{job_id:jobId,status:'synthetic'},pending_digest:claimed.pending_digest})).entity;
}
function estimate(total,own,service){return{total_microunits:total,own_compute_microunits:own,service_microunits:service,currency:'USD'};}
function measurement(kind,total,own,service,{runtime=100,storage=0,egress=0}={}){
  return{kind,total_microunits:total,own_compute_microunits:own,service_microunits:service,currency:'USD',runtime_ms:runtime,storage_bytes:storage,egress_bytes:egress};
}

test('RS-OPS-01 duplicate Platform usage receipt creates one logical usage entry',async t=>{
  const{app}=setup(t),b=await baseline(app),work=await prepareWork(app,b.release.id);
  await completeWork(app,work);
  const reservation=(await execute(app,'usage.reserve',{
    work_id:work.id,reservation_key:'reservation-ops-01',compute_origin:'platform-managed',reserved_microunits:800,
    estimate:estimate(500,400,100)
  })).entity;
  const input={
    reservation_id:reservation.id,source:'semwright-platform',provider_event_id:'usage-event-001',
    observed_at:'2026-10-06T08:00:00.000Z',compute_origin:'platform-managed',
    measurement:measurement('measured',300,200,100,{runtime:1200,storage:1024,egress:32}),
    correlation:{platform_job_id:'job-ops-1',native_receipt_sha256:'a'.repeat(64)}
  };
  const first=await execute(app,'usage.record',input),again=await execute(app,'usage.record',input);
  assert.equal(first.duplicate,false);assert.equal(again.duplicate,true);
  assert.equal(first.entity.id,again.entity.id);assert.equal(app.list('usage_receipt').length,1);
  await assert.rejects(execute(app,'usage.record',{...input,measurement:measurement('measured',301,201,100,{runtime:1200,storage:1024,egress:32})}),{code:'Conflict'});
});

test('RS-OPS-02 reserve, finalize and correction preserve an auditable accounting chain',async t=>{
  const{app}=setup(t),b=await baseline(app),work=await prepareWork(app,b.release.id);
  const reservation=(await execute(app,'usage.reserve',{
    work_id:work.id,reservation_key:'reservation-ops-02',compute_origin:'platform-managed',reserved_microunits:800,
    estimate:estimate(600,500,100)
  })).entity;
  await assert.rejects(execute(app,'usage.reserve',{
    work_id:work.id,reservation_key:'too-large',compute_origin:'platform-managed',reserved_microunits:1001,
    estimate:estimate(600,500,100)
  }),{code:'PolicyDenied'});
  const first=(await execute(app,'usage.record',{
    reservation_id:reservation.id,source:'test-fixture',provider_event_id:'measured-original',
    observed_at:'2026-10-06T08:01:00.000Z',compute_origin:'platform-managed',
    measurement:measurement('measured',300,250,50),correlation:{}
  })).entity;
  const finalized=(await execute(app,'usage.adjust',{
    reservation_id:reservation.id,adjustment_key:'final-001',receipt_ids:[first.id],reason:'Finalize from measured provider receipt'
  })).entity;
  const duplicate=await execute(app,'usage.adjust',{
    reservation_id:reservation.id,adjustment_key:'final-001',receipt_ids:[first.id],reason:'Finalize from measured provider receipt'
  });
  assert.equal(duplicate.duplicate,true);assert.equal(app.list('usage_adjustment').length,1);
  assert.equal(finalized.data.accounting_sequence,1);
  let view=await execute(app,'usage.inspect',{reservation_id:reservation.id});
  assert.equal(view.accounting.accounted_charge_microunits,300);
  assert.equal(view.accounting.released_microunits,500);
  const corrected=(await execute(app,'usage.record',{
    reservation_id:reservation.id,source:'test-fixture',provider_event_id:'measured-correction',
    observed_at:'2026-10-06T08:02:00.000Z',compute_origin:'platform-managed',
    measurement:measurement('measured',250,200,50),correlation:{}
  })).entity;
  const correction=(await execute(app,'usage.adjust',{
    reservation_id:reservation.id,adjustment_key:'correction-001',receipt_ids:[corrected.id],
    replaces_adjustment_id:finalized.id,reason:'Provider supplied corrected measured usage'
  })).entity;
  assert.equal(correction.data.kind,'correction');assert.equal(correction.data.replaces_adjustment_id,finalized.id);
  assert.equal(correction.data.accounting_sequence,2);
  view=await execute(app,'usage.inspect',{reservation_id:reservation.id});
  assert.equal(view.accounting.observed_measured_microunits,550);
  assert.equal(view.accounting.accounted_charge_microunits,250);
  assert.equal(view.accounting.released_microunits,550);
  assert.equal(view.adjustments.length,2);
});

test('RS-OPS-03 estimated, measured and BYO cost classes stay distinct',async t=>{
  const{app}=setup(t),b=await baseline(app),work=await prepareWork(app,b.release.id);
  await assert.rejects(execute(app,'usage.reserve',{
    work_id:work.id,reservation_key:'invalid-byo',compute_origin:'byo',reserved_microunits:200,
    estimate:estimate(100,1,99)
  }),{code:'PolicyDenied'});
  const reservation=(await execute(app,'usage.reserve',{
    work_id:work.id,reservation_key:'valid-byo',compute_origin:'byo',reserved_microunits:200,
    estimate:estimate(100,0,100)
  })).entity;
  await execute(app,'usage.record',{
    reservation_id:reservation.id,source:'test-fixture',provider_event_id:'byo-estimate',
    observed_at:'2026-10-06T08:03:00.000Z',compute_origin:'byo',
    measurement:measurement('estimated',120,0,120),correlation:{}
  });
  const measured=(await execute(app,'usage.record',{
    reservation_id:reservation.id,source:'test-fixture',provider_event_id:'byo-measured',
    observed_at:'2026-10-06T08:04:00.000Z',compute_origin:'byo',
    measurement:measurement('measured',80,0,80),correlation:{}
  })).entity;
  await assert.rejects(execute(app,'usage.record',{
    reservation_id:reservation.id,source:'test-fixture',provider_event_id:'byo-invalid-own-compute',
    observed_at:'2026-10-06T08:05:00.000Z',compute_origin:'byo',
    measurement:measurement('measured',80,1,79),correlation:{}
  }),{code:'PolicyDenied'});
  await execute(app,'usage.adjust',{
    reservation_id:reservation.id,adjustment_key:'byo-final',receipt_ids:[measured.id],reason:'Finalize measured BYO service usage'
  });
  const view=await execute(app,'usage.inspect',{reservation_id:reservation.id});
  assert.equal(view.accounting.estimate_microunits,100);
  assert.equal(view.accounting.observed_estimated_microunits,120);
  assert.equal(view.accounting.observed_measured_microunits,80);
  assert.equal(view.accounting.accounted_charge_microunits,80);
  assert.equal(view.compute.origin,'byo');assert.equal(view.compute.own_compute_charge_forbidden,true);
  assert.equal(view.authority.billing,false);assert.equal(view.limits.runtime_stop_authority,false);
});

test('RS-OPS-04 external limit overruns remain observable instead of being rewritten as compliant',async t=>{
  const{app}=setup(t),b=await baseline(app),work=await prepareWork(app,b.release.id,{cost:500,runtime:1});
  const reservation=(await execute(app,'usage.reserve',{
    work_id:work.id,reservation_key:'reservation-limit-observation',compute_origin:'platform-managed',reserved_microunits:400,
    estimate:estimate(300,250,50)
  })).entity;
  const receipt=(await execute(app,'usage.record',{
    reservation_id:reservation.id,source:'test-fixture',provider_event_id:'limit-overrun-observed',
    observed_at:'2026-10-06T08:05:30.000Z',compute_origin:'platform-managed',
    measurement:measurement('measured',700,600,100,{runtime:1500}),correlation:{}
  })).entity;
  await execute(app,'usage.adjust',{
    reservation_id:reservation.id,adjustment_key:'overrun-final',receipt_ids:[receipt.id],reason:'Preserve externally observed overrun'
  });
  const view=await execute(app,'usage.inspect',{reservation_id:reservation.id});
  assert.equal(view.accounting.work_budget_overage_microunits,200);
  assert.equal(view.limits.cost_ceiling_exceeded,true);
  assert.equal(view.limits.runtime_ceiling_exceeded,true);
  assert.equal(view.limits.max_observed_runtime_ms,1500);
  assert.equal(view.limits.runtime_stop_authority,false);
  assert.equal(view.limits.executor_enforcement,'external-platform-required');
});

test('RS-OPS-05 usage correlation binds Platform job, native receipt and artifact without promoting evidence',async t=>{
  const{app}=setup(t),b=await baseline(app),{artifact}=await candidate(app,b),work=await prepareWork(app,b.release.id);
  await completeWork(app,work,'job-correlated');
  const reservation=(await execute(app,'usage.reserve',{
    work_id:work.id,reservation_key:'reservation-correlation',compute_origin:'platform-managed',reserved_microunits:500,
    estimate:estimate(400,300,100)
  })).entity;
  const receipt=(await execute(app,'usage.record',{
    reservation_id:reservation.id,source:'semwright-platform',provider_event_id:'usage-correlation',
    observed_at:'2026-10-06T08:06:00.000Z',compute_origin:'platform-managed',
    measurement:measurement('measured',350,250,100),
    correlation:{platform_job_id:'job-correlated',native_receipt_sha256:'b'.repeat(64),artifact_id:artifact.id}
  })).entity;
  assert.equal(receipt.data.correlation.platform_job_id,'job-correlated');
  assert.equal(receipt.data.correlation.native_receipt_sha256,'b'.repeat(64));
  assert.equal(receipt.data.correlation.artifact_sha256,artifact.data.sha256);
  assert.equal(receipt.data.technical_evidence_admitted,false);
  await assert.rejects(execute(app,'usage.record',{
    reservation_id:reservation.id,source:'semwright-platform',provider_event_id:'usage-wrong-job',
    observed_at:'2026-10-06T08:07:00.000Z',compute_origin:'platform-managed',
    measurement:measurement('measured',350,250,100),correlation:{platform_job_id:'job-other'}
  }),{code:'Conflict'});
});

test('RS-OPS-09 failed test billing callback never replays work or mutates evidence',async t=>{
  const{app,root}=setup(t),b=await baseline(app),work=await prepareWork(app,b.release.id);
  const reservation=(await execute(app,'usage.reserve',{
    work_id:work.id,reservation_key:'reservation-billing-test',compute_origin:'platform-managed',reserved_microunits:500,
    estimate:estimate(400,300,100)
  })).entity;
  const receipt=(await execute(app,'usage.record',{
    reservation_id:reservation.id,source:'test-fixture',provider_event_id:'billing-measured',
    observed_at:'2026-10-06T08:08:00.000Z',compute_origin:'platform-managed',
    measurement:measurement('measured',300,200,100),correlation:{}
  })).entity;
  const adjustment=(await execute(app,'usage.adjust',{
    reservation_id:reservation.id,adjustment_key:'billing-final',receipt_ids:[receipt.id],reason:'Synthetic test finalization'
  })).entity;
  const workBefore=structuredClone(app.get(work.id)),evidenceBefore=app.list('evidence').length;
  const input={adjustment_id:adjustment.id,callback_id:'test-webhook-failed-1',state:'failed',observed_at:'2026-10-06T08:09:00.000Z'};
  const first=await execute(app,'billing.test_callback',input),again=await execute(app,'billing.test_callback',input);
  assert.equal(first.entity.data.mode,'test');assert.equal(first.entity.data.external_charge,false);
  assert.equal(first.entity.data.render_retry_triggered,false);assert.equal(first.entity.data.evidence_mutated,false);
  assert.equal(again.duplicate,true);assert.equal(app.list('billing_test_receipt').length,1);
  assert.deepEqual(app.get(work.id),workBefore);assert.equal(app.list('evidence').length,evidenceBefore);
  await assert.rejects(execute(app,'billing.test_callback',{...input,state:'accepted'}),{code:'Conflict'});
  const limited=new LaunchwrightApplication(root,{principal:'billing-observer',scopes:['read','edit','capture']});t.after(()=>limited.close());
  await assert.rejects(execute(limited,'billing.test_callback',{...input,callback_id:'test-webhook-no-admin'}),{code:'PermissionDenied'});
});
