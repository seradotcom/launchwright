#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { LaunchwrightApplication, execute } from '../src/application.mjs';
import { BROWSER_RUNTIME_CONTRACT } from '../src/source-profiles.mjs';
import { LAB_MANIFEST } from '../lab/deltadesk/server.mjs';

const semwrightRoot=process.env.SEMWRIGHT_CHECKOUT;
const receiptPath=process.env.DELTADESK_DRIVER_RECEIPT;
const chromiumBin=process.env.SEMWRIGHT_TEST_CHROMIUM;
assert.ok(semwrightRoot&&receiptPath&&chromiumBin,'SEMWRIGHT_CHECKOUT, DELTADESK_DRIVER_RECEIPT and SEMWRIGHT_TEST_CHROMIUM are required');

async function fileSha(path){
  const hash=createHash('sha256');
  for await(const chunk of createReadStream(path))hash.update(chunk);
  return hash.digest('hex');
}
function gitHead(path){
  const run=spawnSync('git',['-C',path,'rev-parse','HEAD'],{encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);return run.stdout.trim();
}
function pngDimensions(path){
  const bytes=readFileSync(path);
  assert.ok(bytes.length>24,'PNG evidence is too small');
  assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a','Evidence is not a PNG');
  return{width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),bytes:bytes.length};
}

const semwrightSha=gitHead(semwrightRoot);
assert.equal(semwrightSha,BROWSER_RUNTIME_CONTRACT.semwright_sha,'Semwright checkout differs from reviewed Chromium source pin');
const browserSha=await fileSha(chromiumBin);
const receipt=JSON.parse(readFileSync(receiptPath,'utf8'));
assert.equal(receipt.schema_version,'launchwright-deltadesk-browser-driver/1');
assert.equal(receipt.semwright_sha,semwrightSha,'Driver receipt references another Semwright SHA');
assert.equal(receipt.provider,BROWSER_RUNTIME_CONTRACT.provider_id);
assert.equal(receipt.browser_executable_sha256,browserSha,'Driver receipt browser digest differs from executable bytes');
assert.equal(receipt.real_semwright_adapter,true);
assert.equal(receipt.agent_javascript,false);
assert.equal(receipt.raw_cdp_exposed,false);
assert.equal(receipt.platform_job_receipt,false,'This lane must not fabricate a Platform receipt');
assert.equal(receipt.oracle.checkout_cta_changed,true);
assert.equal(receipt.oracle.basic_operator_availability_changed,true);
assert.equal(receipt.oracle.pro_operator_availability_preserved,true);
assert.equal(receipt.captures.length,2);

const evidenceDir=dirname(resolve(receiptPath));
const captureByBuild=new Map(receipt.captures.map(row=>[row.build,row]));
for(const [key,expected] of Object.entries({a:'Start Pro trial',b:'Continue with Pro'})){
  const row=captureByBuild.get(key);assert.ok(row,`Missing build ${key} acceptance row`);
  assert.equal(row.checkout_cta,expected);
  assert.equal(row.screenshot.sha256,await fileSha(join(evidenceDir,row.screenshot.file)));
  const dimensions=pngDimensions(join(evidenceDir,row.screenshot.file));
  assert.ok(dimensions.width>=640&&dimensions.height>=480,'Browser evidence is unexpectedly small');
  assert.ok(Object.values(row.semantic_checks).every(Boolean),'A required semantic browser step did not complete');
}

const root=mkdtempSync(join(tmpdir(),'launchwright-deltadesk-profile-'));
const capabilities={
  profile_execution:{browser:'available'},
  profile_runtime:{browser:{
    semwright_sha:semwrightSha,
    provider_id:BROWSER_RUNTIME_CONTRACT.provider_id,
    executable_sha256:browserSha
  }}
};
const app=new LaunchwrightApplication(root,{initialize:true,capabilities});
try{
  const create=async(kind,data)=>(await execute(app,'entity.create',{kind,data})).entity;
  const product=await create('product',{name:'DeltaDesk',description:'Launchwright-owned release acceptance fixture'});
  const preflights=[];
  for(const key of ['a','b']){
    const build=LAB_MANIFEST.builds[key];
    const release=await create('release',{product_id:product.id,name:`DeltaDesk ${build.label}`,build:build.id,status:'draft'});
    const source=await create('source',{
      product_id:product.id,name:`DeltaDesk build ${build.label} web source`,type:'web',
      locator:`${receipt.origin}/build-${key}/login`,build:build.id,coverage:'declared',
      purpose:'Owned real-browser release acceptance',approval:'approved'
    });
    const target=await create('target',{
      release_id:release.id,name:`DeltaDesk ${build.label} pro operator`,ui_locale:'en-US',editorial_locale:'en-US',
      role:'operator',plan:'pro',region:'CI',flags:{advanced_export:true},
      viewport:{width:1280,height:720,scale_milli:1000}
    });
    const preflight=await execute(app,'profile.preflight',{profile:'browser',source_id:source.id,target_id:target.id});
    assert.equal(preflight.ready_for_native_execution,true,'Launchwright browser preflight rejected real pinned Semwright runtime');
    assert.ok(preflight.checks.every(check=>check.state==='PASS'),'Launchwright browser preflight contains a non-PASS check');
    preflights.push({build:build.id,checks:preflight.checks});
  }

  const dimensions=Object.fromEntries(['a','b'].map(key=>{
    const row=captureByBuild.get(key);return[key,pngDimensions(join(evidenceDir,row.screenshot.file))];
  }));
  const evidence={
    schema_version:'launchwright-deltadesk-browser-acceptance/1',
    launchwright_sha:process.env.GITHUB_SHA??null,
    semwright_sha:semwrightSha,
    native_sdk:'0.9.0-dev.1',
    provider:{id:BROWSER_RUNTIME_CONTRACT.provider_id,source_pin:BROWSER_RUNTIME_CONTRACT.semwright_sha},
    browser:{sha256:browserSha},
    deltadesk:{manifest_schema:LAB_MANIFEST.schema_version,builds:Object.fromEntries(Object.entries(LAB_MANIFEST.builds).map(([k,v])=>[k,v.id]))},
    driver_receipt_sha256:await fileSha(receiptPath),
    screenshots:Object.fromEntries(['a','b'].map(key=>{
      const row=captureByBuild.get(key);return[key,{sha256:row.screenshot.sha256,...dimensions[key]}];
    })),
    launchwright_preflights:preflights,
    cross_system_real_browser:true,
    semantic_provider_execution:true,
    platform_receipt_admitted:false,
    launchwright_capture_admitted:false,
    driver_host_isolation_accepted:false,
    note:'This lane proves DeltaDesk A/B through Semwright real Chromium semantic adapter and Launchwright profile compatibility. It intentionally does not fabricate Platform job authority, Launchwright capture admission, or full Driver Host acceptance.'
  };
  mkdirSync('evidence/deltadesk',{recursive:true});
  writeFileSync('evidence/deltadesk/launchwright-deltadesk-browser-acceptance.json',JSON.stringify(evidence,null,2)+'\n');
  process.stdout.write(JSON.stringify(evidence)+'\n');
}finally{
  app.close();
  rmSync(root,{recursive:true,force:true});
}
