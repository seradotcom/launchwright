// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execute } from '../src/application.mjs';
import { setup, baseline, update } from './helpers.mjs';

async function jsonArtifact(app,b){
  const deliverable=await b.create('deliverable',{release_id:b.release.id,name:'Effects fixture',target_id:b.target.id,format:'json',content:'Owned effects fixture.',claim_ids:[],source_ids:[b.source.id]});
  const artifact=(await execute(app,'deliverable.render',{id:deliverable.id})).entity;
  return{deliverable,artifact};
}
const SPEC_TEXT=JSON.stringify({schema_version:'semwright-native-effects-spec/1'});
const SPEC_SHA=createHash('sha256').update(SPEC_TEXT).digest('hex');
function resultFor(sha256,{verdict='PASS',status='unknown'}={}){
  return JSON.stringify({
    schema_version:'semwright-native-effects-result/1',
    spec_sha256:SPEC_SHA,source_digest:'2'.repeat(64),runtime_digest:'3'.repeat(64),
    declared_producer_execution_status:status,context_attestation:'owned synthetic fixture context',
    inspection_state:'EVALUATED',scope:'immutable_native_sdk_artifact_properties_only',
    execution_authority:false,evaluation:{report:{validation:{checks:[]}}},verdict,
    private_measurements:[{rule:'draft',rule_version:1,address:{resource:{provider:'semwright.native-artifact-reader',resource:'release'},logical_id:'draft',property:'scalar'},expected:{kind:'equals',expected:{kind:'bool',value:true}},observed:{kind:'bool',value:true},observation:{id:'file-readback:draft',artifact:sha256},availability:'CANONICAL_SAME_RUN_READBACK'}]
  });
}

test('RS-EFX-01 stored canonical PASS remains UNKNOWN without explicit owner admission',async t=>{
  const{app}=setup(t),b=await baseline(app),{artifact}=await jsonArtifact(app,b);
  const receipt=(await execute(app,'effects.record',{release_id:b.release.id,artifact_ids:[artifact.id],spec_text:SPEC_TEXT,result_text:resultFor(artifact.data.sha256)})).entity;
  assert.equal(receipt.data.admission,'canonical-result-not-admitted');
  const status=await execute(app,'effects.inspect',{release_id:b.release.id});
  assert.equal(status.state,'UNKNOWN');
  assert.equal(status.receipts[0].reported_verdict,'PASS');
  assert.equal(status.receipts[0].effective_verdict,'UNKNOWN');
  assert.equal(status.scenario_effects_authority,false);
});

test('RS-EFX-02 admitted PASS is exact-artifact scoped and revision drift makes it UNKNOWN',async t=>{
  const{app}=setup(t,{capabilities:{canonical_effect_admission:true}}),b=await baseline(app),{artifact}=await jsonArtifact(app,b);
  await execute(app,'effects.record',{release_id:b.release.id,artifact_ids:[artifact.id],spec_text:SPEC_TEXT,result_text:resultFor(artifact.data.sha256),admit:true});
  let status=await execute(app,'effects.inspect',{release_id:b.release.id});
  assert.equal(status.state,'PASS');
  assert.equal(status.receipts[0].current,true);
  await update(app,b.source,{coverage:'partial'});
  status=await execute(app,'effects.inspect',{release_id:b.release.id});
  assert.equal(status.state,'UNKNOWN');
  assert.equal(status.receipts[0].current,false);
  assert.ok(status.receipts[0].drift.some(d=>d.reason==='artifact-input-changed'));
});

test('RS-EFX-03 canonical FAIL remains a failure when admitted and never grants execution authority',async t=>{
  const{app}=setup(t,{capabilities:{canonical_effect_admission:true}}),b=await baseline(app),{artifact}=await jsonArtifact(app,b);
  const receipt=(await execute(app,'effects.record',{release_id:b.release.id,artifact_ids:[artifact.id],spec_text:SPEC_TEXT,result_text:resultFor(artifact.data.sha256,{verdict:'FAIL',status:'completed'}),admit:true})).entity;
  assert.equal(receipt.data.execution_authority,false);
  const status=await execute(app,'effects.inspect',{release_id:b.release.id});
  assert.equal(status.state,'FAIL');
  assert.equal(status.receipts[0].effective_verdict,'FAIL');
});

test('RS-EFX-04 result artifact scope mismatch and unauthorized admission fail closed',async t=>{
  const{app}=setup(t),b=await baseline(app),{artifact}=await jsonArtifact(app,b);
  await assert.rejects(execute(app,'effects.record',{release_id:b.release.id,artifact_ids:[artifact.id],spec_text:SPEC_TEXT,result_text:resultFor('f'.repeat(64))}),{code:'PermissionDenied'});
  await assert.rejects(execute(app,'effects.record',{release_id:b.release.id,artifact_ids:[artifact.id],spec_text:JSON.stringify({schema_version:'semwright-native-effects-spec/1',tampered:true}),result_text:resultFor(artifact.data.sha256)}),{code:'Conflict'});
  await assert.rejects(execute(app,'effects.record',{release_id:b.release.id,artifact_ids:[artifact.id],spec_text:SPEC_TEXT,result_text:resultFor(artifact.data.sha256),admit:true}),{code:'PolicyDenied'});
  assert.equal(app.list('effect_result').length,0);
});
