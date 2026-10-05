// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { execute } from '../src/application.mjs';
import { setup, baseline, update, captureInput } from './helpers.mjs';

async function captureFixture(t,{effects=[]}={}){
  const {app}=setup(t);
  const b=await baseline(app);
  const source=(await update(app,b.source,{approval:'approved',purpose:'Owned local capture fixture'})).entity;
  const scenario=await b.create('scenario',{
    release_id:b.release.id,name:'Owned capture scenario',source_id:source.id,target_id:b.target.id,
    steps:[{action:'navigate',anchor:'root'},{action:'assert',anchor:'root'}],
    anchors:[{name:'root',role:'main',label:'Owned fixture',expected_count:1}],
    readiness:'declared',version_label:'2',reset_strategy:'isolated-context',effects
  });
  return{app,b,source,scenario};
}

test('RS-CAP-01 observed capture requires Platform correlation and native receipt digest',async t=>{
  const{app,b,source,scenario}=await captureFixture(t);
  const missingJob=captureInput(b,source,scenario,{receipt:{platform_job_id:undefined}});
  await assert.rejects(execute(app,'capture.ingest',missingJob),{code:'InvalidArgument'});
  const missingReceipt=captureInput(b,source,scenario,{receipt:{native_receipt_sha256:undefined}});
  await assert.rejects(execute(app,'capture.ingest',missingReceipt),{code:'InvalidArgument'});
  const evidence=(await execute(app,'capture.ingest',captureInput(b,source,scenario))).entity;
  assert.equal(evidence.data.capture_contract,'launchwright-capture/2');
  assert.equal(evidence.data.observed_state_eligible,true);
  assert.equal(evidence.data.technical,'UNKNOWN');
  assert.equal(evidence.data.host_acceptance,'NOT_ESTABLISHED');
});

test('RS-CAP-02 and RS-CAP-03 readiness or ambiguous anchors block observed success',async t=>{
  const{app,b,source,scenario}=await captureFixture(t);
  await assert.rejects(execute(app,'capture.ingest',captureInput(b,source,scenario,{
    readiness:{state:'NOT_READY',checks:[{name:'expected-state',state:'FAIL',detail:'login-screen'}]}
  })),{code:'Conflict'});
  await assert.rejects(execute(app,'capture.ingest',captureInput(b,source,scenario,{
    anchors:[{name:'root',observed_matches:2,source:'accessible',detail:'ambiguous'}]
  })),{code:'Conflict'});
});

test('RS-CAP-04 and RS-CAP-05 target drift and demo-data relabeling fail closed',async t=>{
  const{app,b,source,scenario}=await captureFixture(t);
  await assert.rejects(execute(app,'capture.ingest',captureInput(b,source,scenario,{
    receipt:{build_after:'build-B'}
  })),{code:'Conflict'});
  await assert.rejects(execute(app,'capture.ingest',captureInput(b,source,scenario,{
    provenance:{synthetic:false}
  })),{code:'InvalidArgument'});
  await assert.rejects(execute(app,'capture.ingest',captureInput(b,source,scenario,{
    classification:'actual',provenance:{capture_class:'CAPTURED_DEMO_DATA',synthetic:true}
  })),{code:'InvalidArgument'});
});

test('RS-CAP-07 and RS-CAP-08 mutable capture requires scoped auth and bounded cleanup',async t=>{
  const{app,b,source,scenario}=await captureFixture(t,{effects:[{kind:'create-record',scope:'fixture'}]});
  await assert.rejects(execute(app,'capture.ingest',captureInput(b,source,scenario,{
    isolation:{auth_scope:'operator-session'}
  })),{code:'PermissionDenied'});
  await assert.rejects(execute(app,'capture.ingest',captureInput(b,source,scenario,{
    cleanup:{created_resource_ids:['owned-1'],removed_resource_ids:['other-tenant-1']}
  })),{code:'InvalidArgument'});
});

test('RS-CAP-06 sanitized derivatives preserve source relation without manufacturing PASS',async t=>{
  const{app,b,source,scenario}=await captureFixture(t);
  const parent=(await execute(app,'capture.ingest',captureInput(b,source,scenario))).entity;
  const preserved=(await execute(app,'capture.ingest',captureInput(b,source,scenario,{
    name:'Sanitized crop',classification:'sanitized',
    provenance:{
      capture_class:'SANITIZED_DERIVATIVE',synthetic:true,parent_evidence_id:parent.id,
      transformations:[{kind:'REDACT',operation_ref:'redact-fixture-1',semantic_effect:'preserves-observed-state'}]
    }
  }))).entity;
  assert.equal(preserved.data.parent_evidence_id,parent.id);
  assert.equal(preserved.data.observed_state_eligible,true);
  assert.equal(preserved.data.admission,'derived-provenance-recorded');
  assert.equal(preserved.data.technical,'UNKNOWN');

  const changed=(await execute(app,'capture.ingest',captureInput(b,source,scenario,{
    name:'Edited label',classification:'sanitized',
    provenance:{
      capture_class:'SANITIZED_DERIVATIVE',synthetic:true,parent_evidence_id:parent.id,
      transformations:[{kind:'ANNOTATE',operation_ref:'annotate-fixture-1',semantic_effect:'changes-observed-state'}]
    }
  }))).entity;
  assert.equal(changed.data.observed_state_eligible,false);
});

test('RS-CAP-09 capture segments are ordered and non-overlapping',async t=>{
  const{app,b,source,scenario}=await captureFixture(t);
  await assert.rejects(execute(app,'capture.ingest',captureInput(b,source,scenario,{
    segments:[
      {start_ms:0,end_ms:1000,source_sha256:'b'.repeat(64)},
      {start_ms:900,end_ms:1200,source_sha256:'c'.repeat(64)}
    ]
  })),{code:'InvalidArgument'});
  const evidence=(await execute(app,'capture.ingest',captureInput(b,source,scenario,{
    segments:[
      {start_ms:0,end_ms:1000,source_sha256:'b'.repeat(64)},
      {start_ms:1000,end_ms:1200,source_sha256:'c'.repeat(64),transform:'2x'}
    ]
  }))).entity;
  assert.equal(evidence.data.segments.length,2);
});

test('RS-CAP-10 generated illustration can never become observed product state',async t=>{
  const{app,b,source,scenario}=await captureFixture(t);
  const input=captureInput(b,source,scenario,{
    name:'Editorial illustration',classification:'generated',
    provenance:{capture_class:'GENERATED_ILLUSTRATION',synthetic:true,transformations:[]},
    receipt:{authority:'imported',provider:'launchwright-editor',provider_version:'1',operation_id:'illustration-1',profile:'editorial',outcome:'SUCCEEDED'}
  });
  delete input.receipt.platform_job_id;
  delete input.receipt.native_receipt_sha256;
  delete input.receipt.build_observation;
  delete input.receipt.build_before;
  delete input.receipt.build_after;
  const evidence=(await execute(app,'capture.ingest',input)).entity;
  assert.equal(evidence.data.observed_state_eligible,false);
  assert.equal(evidence.data.admission,'editorial-not-observed');
  assert.equal(evidence.data.technical,'UNKNOWN');
});
