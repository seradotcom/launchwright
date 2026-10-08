// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {execute} from '../src/application.mjs';
import {EffectsRuntimeNativeApplication} from '../src/native-effects-runtime-app.mjs';
import {EFFECTS_RUNTIME_SEMWRIGHT_SHA} from '../src/effects-runtime.mjs';
import {setup,baseline,update} from './helpers.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
const executableSha='e'.repeat(64);
const sourceSha='215295d2a2510c24864d4226e6b78c1abe3de04601c85c59a99543d8ef1336ff';
const SPEC_TEXT=JSON.stringify({schema_version:'semwright-native-effects-spec/1'});
const SPEC_SHA=sha(SPEC_TEXT);

async function jsonArtifact(app,b){
  const deliverable=await b.create('deliverable',{release_id:b.release.id,name:'R29 effects fixture',target_id:b.target.id,format:'json',content:'Owned R29 effects fixture.',claim_ids:[],source_ids:[b.source.id]});
  return(await execute(app,'deliverable.render',{id:deliverable.id})).entity;
}
function resultFor(artifactSha,{verdict='PASS',runtimeDigest=executableSha}={}){
  return JSON.stringify({
    schema_version:'semwright-native-effects-result/1',
    spec_sha256:SPEC_SHA,source_digest:sourceSha,runtime_digest:runtimeDigest,
    declared_producer_execution_status:'unknown',context_attestation:'DECLARED_CONTEXT_NOT_NATIVE_EXECUTION_ATTESTATION',
    inspection_state:'EVALUATED',scope:'immutable_native_sdk_artifact_properties_only',
    execution_authority:false,evaluation:{report:{validation:{checks:[]}}},verdict,
    private_measurements:[{rule:'draft',rule_version:1,address:{resource:{provider:'semwright.native-artifact-reader',resource:'release'},logical_id:'draft',property:'scalar'},expected:{kind:'equals',expected:{kind:'bool',value:true}},observed:{kind:'bool',value:true},observation:{id:'file-readback:draft',artifact:artifactSha},availability:'CANONICAL_SAME_RUN_READBACK'}]
  });
}
function driverReport(resultText){
  const result=JSON.parse(resultText);
  return{
    schema_version:'launchwright-effects-driver-result/1',
    spec_sha256:SPEC_SHA,
    result_sha256:sha(resultText),
    result_text:resultText,
    verdict:result.verdict,
    inspection_state:result.inspection_state,
    scope:result.scope,
    runtime_digest:result.runtime_digest,
    source_digest:result.source_digest,
    execution_authority:false
  };
}
function envelope(resultText,overrides={}){
  return{
    schema_version:'launchwright-effects-runtime/1',
    observed_at:'2026-10-08T03:00:00.100Z',
    semwright_sha:EFFECTS_RUNTIME_SEMWRIGHT_SHA,
    provider:'driver:launchwright-effects',
    provider_version:'0.2.0-dev.1',
    provider_generation:9,
    descriptor_sha256:'d'.repeat(64),
    provider_executable_sha256:executableSha,
    evaluator_executable_sha256:executableSha,
    command:'driver.launchwright-effects.verify',
    broker_policy_path_observed:true,
    driver_host_isolation_accepted:true,
    evaluator_driver_host_isolated:true,
    platform_execution_authority:false,
    external_customer_acceptance:false,
    report:driverReport(resultText),
    ...overrides,
    report:{...driverReport(resultText),...(overrides.report??{})}
  };
}
function pin(root,name,value){
  const bytes=Buffer.from(JSON.stringify(value,null,2)+'\n');
  writeFileSync(join(root,name),bytes,{mode:0o600});
  return{file:name,sha256:sha(bytes)};
}

test('R29 exact Driver Host Effects receipt admits a current canonical PASS only',async t=>{
  const{app,root,effectsReceiptRoot}=setup(t),b=await baseline(app),artifact=await jsonArtifact(app,b);
  const resultText=resultFor(artifact.data.sha256);
  const ref=pin(effectsReceiptRoot,'r29-effects.json',envelope(resultText));
  const native=new EffectsRuntimeNativeApplication(root,{effectsReceiptRoot});t.after(()=>native.close());
  const stored=native.mutate('effects.record',{release_id:b.release.id,artifact_ids:[artifact.id],spec_text:SPEC_TEXT,result_text:resultText,admit:true,runtime_receipt:ref}).entity;
  assert.equal(stored.data.admission,'canonical-driver-host-admitted');
  assert.equal(stored.data.execution_authority,false);
  assert.equal(stored.data.runtime_admission.evaluator_driver_host_isolated,true);
  let status=await execute(app,'effects.inspect',{release_id:b.release.id});
  assert.equal(status.state,'PASS');
  assert.equal(status.canonical_passes,1);
  assert.equal(status.receipts[0].verified_evaluator_execution,true);
  assert.equal(status.receipts[0].evaluator_driver_host_isolated,true);
  assert.equal(status.scenario_effects_authority,false);
  await update(app,b.source,{coverage:'partial'});
  status=await execute(app,'effects.inspect',{release_id:b.release.id});
  assert.equal(status.state,'UNKNOWN');
  assert.equal(status.receipts[0].current,false);
});

test('normal application and old capability flag cannot self-admit an Effects PASS',async t=>{
  const{app,effectsReceiptRoot}=setup(t,{capabilities:{canonical_effect_admission:true}}),b=await baseline(app),artifact=await jsonArtifact(app,b);
  const resultText=resultFor(artifact.data.sha256);
  const ref=pin(effectsReceiptRoot,'r29-no-shortcut.json',envelope(resultText));
  await assert.rejects(execute(app,'effects.record',{release_id:b.release.id,artifact_ids:[artifact.id],spec_text:SPEC_TEXT,result_text:resultText,admit:true,runtime_receipt:ref}),{code:'PolicyDenied'});
  await assert.rejects(execute(app,'effects.record',{release_id:b.release.id,artifact_ids:[artifact.id],spec_text:SPEC_TEXT,result_text:resultText,admit:true}),{code:'PolicyDenied'});
});

test('R29 admission rejects result substitution, runtime substitution and external authority escalation',async t=>{
  const{app,root,effectsReceiptRoot}=setup(t),b=await baseline(app),artifact=await jsonArtifact(app,b);
  const resultText=resultFor(artifact.data.sha256),native=new EffectsRuntimeNativeApplication(root,{effectsReceiptRoot});t.after(()=>native.close());
  const ref=pin(effectsReceiptRoot,'r29-exact.json',envelope(resultText));
  const substituted=resultFor(artifact.data.sha256,{verdict:'FAIL'});
  assert.throws(()=>native.mutate('effects.record',{release_id:b.release.id,artifact_ids:[artifact.id],spec_text:SPEC_TEXT,result_text:substituted,admit:true,runtime_receipt:ref}),{code:'Conflict'});
  const badRuntime=resultFor(artifact.data.sha256,{runtimeDigest:'a'.repeat(64)});
  const badRuntimeRef=pin(effectsReceiptRoot,'r29-runtime.json',envelope(badRuntime));
  assert.throws(()=>native.mutate('effects.record',{release_id:b.release.id,artifact_ids:[artifact.id],spec_text:SPEC_TEXT,result_text:badRuntime,admit:true,runtime_receipt:badRuntimeRef}),{code:'Conflict'});
  const elevated=pin(effectsReceiptRoot,'r29-elevated.json',envelope(resultText,{platform_execution_authority:true}));
  assert.throws(()=>native.mutate('effects.record',{release_id:b.release.id,artifact_ids:[artifact.id],spec_text:SPEC_TEXT,result_text:resultText,admit:true,runtime_receipt:elevated}),{code:'Conflict'});
});

test('R29 receipt is spec-bound and evaluator identity must equal the Host provider binary',async t=>{
  const{app,root,effectsReceiptRoot}=setup(t),b=await baseline(app),artifact=await jsonArtifact(app,b),resultText=resultFor(artifact.data.sha256);
  const native=new EffectsRuntimeNativeApplication(root,{effectsReceiptRoot});t.after(()=>native.close());
  const otherEvaluator=pin(effectsReceiptRoot,'r29-other-evaluator.json',envelope(resultText,{evaluator_executable_sha256:'f'.repeat(64)}));
  assert.throws(()=>native.mutate('effects.record',{release_id:b.release.id,artifact_ids:[artifact.id],spec_text:SPEC_TEXT,result_text:resultText,admit:true,runtime_receipt:otherEvaluator}),{code:'Conflict'});
  const otherSpec=JSON.stringify({schema_version:'semwright-native-effects-spec/1',different:true});
  const ref=pin(effectsReceiptRoot,'r29-spec.json',envelope(resultText));
  assert.throws(()=>native.mutate('effects.record',{release_id:b.release.id,artifact_ids:[artifact.id],spec_text:otherSpec,result_text:resultText,admit:true,runtime_receipt:ref}),{code:'Conflict'});
});
