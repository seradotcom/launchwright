#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { LaunchwrightApplication, execute } from '../src/application.mjs';
import { GODOT_RUNTIME_CONTRACT } from '../src/source-profiles.mjs';

const tracePath=process.env.SEMWRIGHT_GODOT_TRACE;
const semwrightRoot=process.env.SEMWRIGHT_CHECKOUT;
const godotBin=process.env.GODOT_BIN;
assert.ok(tracePath&&semwrightRoot&&godotBin,'SEMWRIGHT_GODOT_TRACE, SEMWRIGHT_CHECKOUT and GODOT_BIN are required');

async function fileSha(path){
  const hash=createHash('sha256');
  for await(const chunk of createReadStream(path))hash.update(chunk);
  return hash.digest('hex');
}
function gitHead(path){
  const run=spawnSync('git',['-C',path,'rev-parse','HEAD'],{encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);return run.stdout.trim();
}

const semwrightSha=gitHead(semwrightRoot);
assert.equal(semwrightSha,GODOT_RUNTIME_CONTRACT.semwright_sha,'Semwright checkout differs from reviewed Godot source pin');
const engineSha=await fileSha(godotBin);
assert.equal(engineSha,GODOT_RUNTIME_CONTRACT.engine_sha256,'Godot binary digest differs from reviewed runtime pin');

const trace=JSON.parse(readFileSync(tracePath,'utf8'));
assert.equal(trace.executed,true,'Semwright real-Godot trace did not complete');
assert.match(trace.godot_version,/^4\.7\.2(?:\.|$)/,'Godot trace reports another engine version');
assert.ok(Array.isArray(trace.operations)&&trace.operations.length>0,'Real-Godot trace contains no operations');
const commands=new Set(trace.operations.map(operation=>operation.command));
const required=[
  'driver.godot.scene.inspect',
  'driver.godot.project.validate',
  'driver.godot.project.run_test',
  'driver.godot.export.pack'
];
for(const command of required)assert.ok(commands.has(command),`Real-Godot acceptance omitted ${command}`);

const root=mkdtempSync(join(tmpdir(),'launchwright-godot-acceptance-'));
const capabilities={
  profile_execution:{godot:'available'},
  profile_runtime:{godot:{
    semwright_sha:semwrightSha,
    driver_version:GODOT_RUNTIME_CONTRACT.driver_version,
    engine_version:GODOT_RUNTIME_CONTRACT.engine_version,
    engine_sha256:engineSha
  }}
};
const app=new LaunchwrightApplication(root,{initialize:true,capabilities});
try{
  const create=async(kind,data)=>(await execute(app,'entity.create',{kind,data})).entity;
  const product=await create('product',{name:'Godot acceptance product',description:'Ephemeral CI-owned fixture'});
  const release=await create('release',{product_id:product.id,name:'Godot acceptance',build:'semwright-godot-real-4.7.2',status:'draft'});
  const source=await create('source',{
    product_id:product.id,name:'Semwright real Godot fixture',type:'godot',
    locator:'godot://project/semwright-real-acceptance',build:release.data.build,coverage:'declared',
    purpose:'Cross-system real-engine acceptance',approval:'approved'
  });
  const target=await create('target',{
    release_id:release.id,name:'Godot Linux real engine',ui_locale:'en-US',editorial_locale:'en-US',
    role:'viewer',plan:'test',region:'CI',flags:{advanced_export:false},
    viewport:{width:1280,height:720,scale_milli:1000}
  });
  const preflight=await execute(app,'profile.preflight',{profile:'godot',source_id:source.id,target_id:target.id});
  assert.equal(preflight.ready_for_native_execution,true,'Launchwright rejected the exact reviewed Godot runtime pin');
  assert.ok(preflight.checks.every(check=>check.state==='PASS'),'Godot source preflight is not fully PASS');

  const evidence={
    schema_version:'launchwright-godot-acceptance/1',
    launchwright_sha:process.env.GITHUB_SHA??null,
    semwright_sha:semwrightSha,
    native_sdk:'0.9.0-dev.1',
    driver:{id:GODOT_RUNTIME_CONTRACT.driver_id,version:GODOT_RUNTIME_CONTRACT.driver_version,protocol:GODOT_RUNTIME_CONTRACT.driver_protocol},
    engine:{version:trace.godot_version,sha256:engineSha},
    real_engine_trace:{operations:trace.operations.length,required_operations:required,child_events:Array.isArray(trace.events)?trace.events.length:0},
    launchwright_preflight:{ready_for_native_execution:preflight.ready_for_native_execution,checks:preflight.checks},
    cross_system_real_engine:true,
    platform_receipt_admitted:false,
    launchwright_capture_admitted:false,
    driver_host_isolation_accepted:false,
    note:'This lane proves the pinned Semwright production Godot driver against the real pinned engine and Launchwright profile compatibility. It does not invent a Platform job receipt, capture admission, or Driver Host isolation result.'
  };
  mkdirSync('evidence/godot',{recursive:true});
  writeFileSync('evidence/godot/launchwright-godot-acceptance.json',JSON.stringify(evidence,null,2)+'\n');
  process.stdout.write(JSON.stringify(evidence)+'\n');
}finally{
  app.close();
  rmSync(root,{recursive:true,force:true});
}
