#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dispatchApplication, applicationContext, exactRequestDigest } from '@semwright/native-sdk';
import { LaunchwrightApplication, execute } from '../src/application.mjs';
import { IntegrationsNativeApplication } from '../src/native-integrations-app.mjs';
import { makeRequest } from '../src/base.mjs';
import { nativeDriverName } from '../src/native-profile-base.mjs';
import { GODOT_REQUIRED_OPERATIONS, PROFILE_RUNTIME_SEMWRIGHT_SHA } from '../src/profile-execution.mjs';

const fail=message=>{throw new Error(message);};
const need=(condition,message)=>condition||fail(message);
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const fileSha=path=>sha256(readFileSync(path));
const fullCommit=(value,label)=>{
  need(typeof value==='string'&&/^[0-9a-f]{40}$/.test(value),label+' must be a full lowercase SHA');
  return value;
};

const tracePath=process.env.SEMWRIGHT_GODOT_TRACE??'evidence/godot/godot-real-trace.json';
const outputPath=process.env.LAUNCHWRIGHT_GODOT_REPORT??'evidence/godot/launchwright-godot-profile.json';
const godotBin=process.env.GODOT_BIN;
const driverBin=process.env.GODOT_DRIVER_BIN;
const launchwrightSha=fullCommit(process.env.GITHUB_SHA??process.env.LAUNCHWRIGHT_SHA,'Launchwright SHA');
const semwrightSha=fullCommit(process.env.SEMWRIGHT_SHA??'', 'Semwright SHA');
need(semwrightSha===PROFILE_RUNTIME_SEMWRIGHT_SHA,'Semwright checkout differs from the reviewed Launchwright source lock');
need(godotBin&&driverBin,'GODOT_BIN and GODOT_DRIVER_BIN are required');
need(process.env.GODOT_HOST_CONFORMANCE==='PASS','Godot Driver Host conformance must pass before profile acceptance');

const traceBytes=readFileSync(tracePath);
const trace=JSON.parse(traceBytes);
need(trace.executed===true,'Real Godot trace does not assert execution');
need(trace.godot_version==='4.7.2.stable.official.ed1daf0bf','Unexpected Godot engine version');
need(Array.isArray(trace.operations)&&trace.operations.length>0,'Godot trace has no operations');
need(Array.isArray(trace.events)&&trace.events.some(event=>String(event?.kind??'').startsWith('godot.')),'Godot child events were not observed');

const commands=trace.operations.map(row=>row?.command).filter(value=>typeof value==='string');
const commandSet=new Set(commands);
for(const required of GODOT_REQUIRED_OPERATIONS)need(commandSet.has(required),'Required Godot semantic operation was not observed: '+required);

const last=name=>[...trace.operations].reverse().find(row=>row?.command===name);
const validate=last('driver.godot.project.validate');
need(validate?.result?.success===true&&validate?.result?.exit_code===0,'Godot project.validate did not pass');
const runtime=last('driver.godot.project.run_test');
need(runtime?.result?.success===true,'Godot project.run_test did not pass');
need(String(runtime?.result?.stdout??'').includes('SEMWRIGHT_LAB_READY'),'Godot runtime marker was not emitted');
const pack=last('driver.godot.export.pack');
need(pack?.result?.success===true&&pack?.result?.artifact==='lab-room.pck','Godot pack export did not pass');
const artifacts=(pack.progress??[]).flatMap(frame=>Array.isArray(frame?.artifacts)?frame.artifacts:[]);
const pck=artifacts.find(row=>row?.reference==='artifact:godot:lab-room.pck');
need(pck&&/^[0-9a-f]{64}$/.test(String(pck.sha256??''))&&Number.isInteger(pck.bytes)&&pck.bytes>0,'Godot export artifact receipt is missing or invalid');

const selectedCommands=GODOT_REQUIRED_OPERATIONS.filter(name=>commandSet.has(name));
const traceDigest=sha256(traceBytes);
const engineDigest=fileSha(godotBin);
const driverDigest=fileSha(driverBin);
const startedAt=new Date(Number(process.env.GODOT_PROFILE_STARTED_MS??Date.now())-1000).toISOString();
const finishedAt=new Date().toISOString();

const stateRoot=mkdtempSync(join(tmpdir(),'launchwright-godot-profile-'));
let receiptEntity,receiptInspect;
try{
  const app=new LaunchwrightApplication(stateRoot,{initialize:true});
  const create=async(kind,data)=>(await execute(app,'entity.create',{kind,data})).entity;
  const product=await create('product',{name:'R25 owned Godot fixture',description:'Disposable exact-SHA profile acceptance'});
  const release=await create('release',{product_id:product.id,name:'R25',build:'godot-4.7.2-owned',status:'draft'});
  const source=await create('source',{
    product_id:product.id,name:'Owned Godot 4.7.2 fixture',type:'godot',locator:'project:semwright-owned-godot-r25',
    build:release.data.build,coverage:'declared',purpose:'RS-PRO-02 exact-SHA native engine acceptance',approval:'approved'
  });
  const target=await create('target',{
    release_id:release.id,name:'Godot native profile',ui_locale:'en-US',editorial_locale:'en-US',
    role:'owner',plan:'acceptance',region:'CI',flags:{advanced_export:false},
    viewport:{width:1280,height:720,scale_milli:1000}
  });
  app.close();

  const native=new IntegrationsNativeApplication(stateRoot);
  try{
    const input={
      profile:'godot',source_id:source.id,target_id:target.id,name:'R25 Godot real-engine acceptance',
      semwright_sha:semwrightSha,
      engine:{family:'Godot',version:trace.godot_version,binary_sha256:engineDigest,real:true},
      driver:{namespace:'driver.godot.',protocol:3,capability_count:188,binary_sha256:driverDigest},
      trace_sha256:traceDigest,observed_operations:[...new Set(commands)].sort(),
      semantics:{scene:true,camera:true,behavior:true,readback:true,persistence:true,runtime:true},
      runtime_marker:'SEMWRIGHT_LAB_READY',
      redacted_artifact_refs:[pck.reference,'sha256:'+pck.sha256],
      driver_host_conformance_observed:true,started_at:startedAt,finished_at:finishedAt
    };
    const expected=native.store.version(),epoch=native.store.meta().epoch,key='r25-godot-profile-record';
    const request=makeRequest('profile.execution_record',input,expected,epoch,key);
    const recorded=await dispatchApplication(
      native,'invoke',nativeDriverName('profile.execution_record'),
      {ref:'ci-owned-godot-profile-evidence',...request},
      applicationContext(key,expected)
    );
    receiptEntity=recorded.entity;
    const readExpected=native.store.version();
    receiptInspect=await dispatchApplication(
      native,'invoke',nativeDriverName('profile.execution_inspect'),
      {ref:'ci-owned-godot-profile-evidence',input:{id:receiptEntity.id}},
      applicationContext('r25-godot-profile-read',readExpected)
    );
  }finally{native.close();}
}finally{
  rmSync(stateRoot,{recursive:true,force:true,maxRetries:5,retryDelay:50});
}

need(receiptEntity?.kind==='profile_execution','Native SDK did not retain the Godot profile receipt');
need(receiptEntity.data?.technical_state==='UNKNOWN','Application custody must not manufacture technical PASS');
need(receiptInspect?.freshness==='CURRENT','Native SDK Godot receipt was not current at readback');
need(receiptInspect?.exact_sha_ci_acceptance===false,'Durable application receipt must not manufacture exact-SHA acceptance');
need(receiptInspect?.video_import_substitute===false,'Video import unexpectedly substituted for engine acceptance');

const facts={
  launchwright_sha:launchwrightSha,
  semwright_sha:semwrightSha,
  requirement_id:'RS-PRO-02',
  profile:'godot',
  engine_version:trace.godot_version,
  engine_binary_sha256:engineDigest,
  driver_binary_sha256:driverDigest,
  trace_sha256:traceDigest,
  operation_count:trace.operations.length,
  required_operation_count:selectedCommands.length,
  child_event_count:trace.events.length,
  export_artifact_sha256:pck.sha256,
  native_sdk_receipt_sha256:receiptEntity.data.receipt_sha256
};
const report={
  schema_version:'launchwright-godot-profile-acceptance/1',
  ...facts,
  chain_sha256:exactRequestDigest('launchwright/godot-profile-acceptance/1',facts),
  acceptance_state:'PASS',
  scope:'OWNED_DISPOSABLE_GODOT_ENGINE_EXACT_SHA',
  profile_contract:{
    scene:'PASS',camera:'PASS',behavior:'PASS',readback:'PASS',persistence:'PASS',runtime:'PASS',
    engine_real_required:true,engine_real_observed:true,video_import_substitute:false
  },
  command_or_ui_flow:selectedCommands,
  observed_result:{
    project_validate:'PASS',project_run_test:'PASS',runtime_marker:'SEMWRIGHT_LAB_READY',
    child_events:'PASS',pack_export:'PASS'
  },
  redacted_artifact_refs:[
    {reference:pck.reference,sha256:pck.sha256,bytes:pck.bytes}
  ],
  native_sdk:{
    profile:'integrations',receipt_recorded:true,receipt_id:receiptEntity.id,
    receipt_sha256:receiptEntity.data.receipt_sha256,readback_freshness:receiptInspect.freshness,
    durable_receipt_technical_state:receiptEntity.data.technical_state
  },
  authority:{
    real_engine_execution_observed:true,
    driver_host_conformance_observed:true,
    same_end_to_end_host_engine_path:false,
    platform_execution_authority:false,
    external_customer_acceptance:false,
    mobile_host_equivalence:false,
    ios_host_equivalence:false
  },
  explanation:'Exact pinned Semwright exercised the owned fixture with the real Godot 4.7.2 engine and the required scene, camera, behavior, readback, persistence and runtime operations. A separate exact-source Driver Host conformance test passed. The Launchwright Native SDK integrations profile retained and reread the bounded receipt without promoting it to application technical PASS. Video import is not accepted as a substitute, and this evidence does not create Platform, customer, mobile or iOS authority.'
};
writeFileSync(outputPath,JSON.stringify(report,null,2)+'\n');
console.log('LAUNCHWRIGHT_GODOT_PROFILE_PASS '+JSON.stringify(report));
