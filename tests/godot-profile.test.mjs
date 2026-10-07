// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { LaunchwrightApplication, execute } from '../src/application.mjs';
import { IntegrationsNativeApplication } from '../src/native-integrations-app.mjs';
import { dispatchApplication, applicationContext } from '@semwright/native-sdk';
import { makeRequest } from '../src/base.mjs';
import { nativeDriverName } from '../src/native-profile-base.mjs';
import { GODOT_REQUIRED_OPERATIONS, PROFILE_RUNTIME_SEMWRIGHT_SHA } from '../src/profile-execution.mjs';
import { setup, baseline, update } from './helpers.mjs';

async function godotFixture(app){
  const b=await baseline(app);
  const source=await b.create('source',{
    product_id:b.product.id,name:'Owned Godot fixture',type:'godot',locator:'project:owned-godot-fixture',
    build:b.release.data.build,coverage:'declared',purpose:'RS-PRO-02 owned engine acceptance',approval:'approved'
  });
  return{...b,godotSource:source};
}

function receipt(b,overrides={}){
  const base={
    profile:'godot',source_id:b.godotSource.id,target_id:b.target.id,name:'Godot 4.7.2 native profile receipt',
    semwright_sha:PROFILE_RUNTIME_SEMWRIGHT_SHA,
    engine:{family:'Godot',version:'4.7.2.stable.official.ed1daf0bf',binary_sha256:'a'.repeat(64),real:true},
    driver:{namespace:'driver.godot.',protocol:3,capability_count:188,binary_sha256:'b'.repeat(64)},
    trace_sha256:'c'.repeat(64),observed_operations:[...GODOT_REQUIRED_OPERATIONS],
    semantics:{scene:true,camera:true,behavior:true,readback:true,persistence:true,runtime:true},
    runtime_marker:'SEMWRIGHT_LAB_READY',
    redacted_artifact_refs:['artifact:godot:lab-room.pck','sha256:'+('d'.repeat(64))],
    driver_host_conformance_observed:true,
    started_at:'2026-10-07T06:00:00.000Z',finished_at:'2026-10-07T06:01:00.000Z'
  };
  return{
    ...base,...overrides,
    engine:{...base.engine,...(overrides.engine??{})},
    driver:{...base.driver,...(overrides.driver??{})},
    semantics:{...base.semantics,...(overrides.semantics??{})}
  };
}

async function nativeInvoke(root,operation,input){
  const app=new IntegrationsNativeApplication(root);
  try{
    const expected=app.store.version(),epoch=app.store.meta().epoch;
    const args=makeRequest(operation,input,expected,epoch);
    return await dispatchApplication(app,'invoke',nativeDriverName(operation),{
      ref:'godot-profile-host-bound-reference',...args
    },applicationContext(args.request.key,expected));
  }finally{app.close();}
}
async function nativeRead(root,operation,input){
  const app=new IntegrationsNativeApplication(root);
  try{
    const expected=app.store.version();
    return await dispatchApplication(app,'invoke',nativeDriverName(operation),{
      ref:'godot-profile-host-bound-reference',input
    },applicationContext('godot-profile-read',expected));
  }finally{app.close();}
}

test('Godot matrix requires real engine semantics and forbids video substitution',async t=>{
  const{app}=setup(t);const b=await godotFixture(app);
  const matrix=await execute(app,'profile.matrix',{});
  assert.deepEqual(matrix.profiles.godot.semantics,['scene','camera','behavior','readback']);
  assert.equal(matrix.profiles.godot.native_acceptance.engine_real_required,true);
  assert.equal(matrix.profiles.godot.native_acceptance.video_import_substitute,false);
  assert.equal(matrix.profiles.godot.native_acceptance.reviewed_engine,'4.7.2');
  const preflight=await execute(app,'profile.preflight',{profile:'godot',source_id:b.godotSource.id,target_id:b.target.id});
  assert.equal(preflight.checks.find(c=>c.name==='source-type').state,'PASS');
  assert.equal(preflight.checks.find(c=>c.name==='execution-authority').state,'UNKNOWN');
  assert.equal(preflight.ready_for_native_execution,false);
});

test('Godot profile receipt preserves real-engine evidence without manufacturing technical PASS',async t=>{
  const{app}=setup(t);const b=await godotFixture(app);
  const recorded=(await execute(app,'profile.execution_record',receipt(b))).entity;
  assert.equal(recorded.kind,'profile_execution');
  assert.equal(recorded.data.requirement_id,'RS-PRO-02');
  assert.equal(recorded.data.engine_execution_observed,true);
  assert.equal(recorded.data.video_import_substitute,false);
  assert.equal(recorded.data.native_acceptance,'EVIDENCE_RECORDED');
  assert.equal(recorded.data.technical_state,'UNKNOWN');
  const inspected=await execute(app,'profile.execution_inspect',{id:recorded.id});
  assert.equal(inspected.freshness,'CURRENT');
  assert.equal(inspected.engine_execution_observed,true);
  assert.equal(inspected.exact_sha_ci_acceptance,false);
  assert.equal(inspected.technical_state,'UNKNOWN');
});

test('Godot evidence rejects fake engine, incomplete semantics and source-lock drift',async t=>{
  const{app}=setup(t);const b=await godotFixture(app);
  await assert.rejects(execute(app,'profile.execution_record',receipt(b,{engine:{real:false}})),{code:'InvalidArgument'});
  await assert.rejects(execute(app,'profile.execution_record',receipt(b,{semantics:{camera:false}})),{code:'InvalidArgument'});
  await assert.rejects(execute(app,'profile.execution_record',receipt(b,{semwright_sha:'0'.repeat(40)})),{code:'StaleReference'});
  await assert.rejects(execute(app,'profile.execution_record',receipt(b,{observed_operations:GODOT_REQUIRED_OPERATIONS.filter(x=>x!=='driver.godot.project.run_test')})),{code:'InvalidArgument'});
});

test('Godot receipt is source/target revision bound and refuses a web source',async t=>{
  const{app}=setup(t);const b=await godotFixture(app);
  const recorded=(await execute(app,'profile.execution_record',receipt(b))).entity;
  await update(app,b.godotSource,{purpose:'Changed owned purpose'});
  const inspected=await execute(app,'profile.execution_inspect',{id:recorded.id});
  assert.equal(inspected.freshness,'STALE');
  assert.ok(inspected.reasons.includes('source-revision-changed'));
  await assert.rejects(execute(app,'profile.execution_record',receipt({...b,godotSource:b.source})),{code:'ProtocolMismatch'});
});

test('Integrations Native SDK profile records and reads the same bounded Godot receipt',async t=>{
  const seeded=setup(t),b=await godotFixture(seeded.app),root=seeded.root;
  seeded.app.close();
  const result=await nativeInvoke(root,'profile.execution_record',receipt(b));
  assert.equal(result.entity.kind,'profile_execution');
  assert.equal(result.entity.data.profile,'godot');
  assert.equal(result.entity.data.technical_state,'UNKNOWN');
  const inspected=await nativeRead(root,'profile.execution_inspect',{id:result.entity.id});
  assert.equal(inspected.freshness,'CURRENT');
  assert.equal(inspected.profile_contract.native_acceptance.engine_real_required,true);
  assert.equal(inspected.exact_sha_ci_acceptance,false);
});
