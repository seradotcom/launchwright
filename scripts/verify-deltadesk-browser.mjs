#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { LaunchwrightApplication, execute } from '../src/application.mjs';
import { LAB_MANIFEST } from '../lab/deltadesk/server.mjs';

const semwrightRoot=process.env.SEMWRIGHT_CHECKOUT;
const receiptPath=process.env.DELTADESK_DRIVER_RECEIPT;
const chromiumBin=process.env.SEMWRIGHT_TEST_CHROMIUM;
assert.ok(semwrightRoot&&receiptPath&&chromiumBin,'SEMWRIGHT_CHECKOUT, DELTADESK_DRIVER_RECEIPT and SEMWRIGHT_TEST_CHROMIUM are required');

const sourceLock=JSON.parse(readFileSync(new URL('../SOURCE_LOCK.json',import.meta.url),'utf8'));
const expectedSemwrightSha=sourceLock.native_sdk.sha;
const expectedSdkVersion=sourceLock.native_sdk.version;

async function fileSha(path){
  const hash=createHash('sha256');
  for await(const chunk of createReadStream(path))hash.update(chunk);
  return hash.digest('hex');
}
function gitHead(path){
  const run=spawnSync('git',['-C',path,'rev-parse','HEAD'],{encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
  return run.stdout.trim();
}
function pngDimensions(path){
  const bytes=readFileSync(path);
  assert.ok(bytes.length>24,'PNG evidence is too small');
  assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a','Evidence is not a PNG');
  return{width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),bytes:bytes.length};
}

const semwrightSha=gitHead(semwrightRoot);
assert.equal(semwrightSha,expectedSemwrightSha,'Semwright checkout differs from Launchwright SOURCE_LOCK');
const browserSha=await fileSha(chromiumBin);
const receipt=JSON.parse(readFileSync(receiptPath,'utf8'));
assert.equal(receipt.schema_version,'launchwright-deltadesk-browser-driver/1');
assert.equal(receipt.semwright_sha,semwrightSha,'Driver receipt references another Semwright SHA');
assert.equal(receipt.provider,'chromium');
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
const receiptSha=await fileSha(receiptPath);
const captureByBuild=new Map(receipt.captures.map(row=>[row.build,row]));
const screenshotEvidence={};
for(const [key,expected] of Object.entries({a:'Start Pro trial',b:'Continue with Pro'})){
  const row=captureByBuild.get(key);
  assert.ok(row,`Missing build ${key} acceptance row`);
  assert.equal(row.checkout_cta,expected);
  const screenshotPath=join(evidenceDir,row.screenshot.file);
  assert.equal(row.screenshot.sha256,await fileSha(screenshotPath));
  const dimensions=pngDimensions(screenshotPath);
  assert.ok(dimensions.width>=640&&dimensions.height>=480,'Browser evidence is unexpectedly small');
  assert.ok(Object.values(row.semantic_checks).every(Boolean),'A required semantic browser step did not complete');
  screenshotEvidence[key]={sha256:row.screenshot.sha256,...dimensions};
}

const root=mkdtempSync(join(tmpdir(),'launchwright-deltadesk-r10-'));
const app=new LaunchwrightApplication(root,{initialize:true});
const admitted=[];
try{
  const create=async(kind,data)=>(await execute(app,'entity.create',{kind,data})).entity;
  const product=await create('product',{name:'DeltaDesk',description:'Launchwright-owned synthetic real-browser acceptance fixture'});
  for(const key of ['a','b']){
    const build=LAB_MANIFEST.builds[key];
    const row=captureByBuild.get(key);
    const release=await create('release',{product_id:product.id,name:`DeltaDesk ${build.label}`,build:build.id,status:'draft'});
    const source=await create('source',{
      product_id:product.id,
      name:`DeltaDesk build ${build.label} browser fixture`,
      type:'web',
      locator:`${receipt.origin}/build-${key}/login`,
      build:build.id,
      coverage:'declared',
      purpose:'Owned Semwright Chromium adapter acceptance on synthetic release fixture',
      approval:'approved'
    });
    const target=await create('target',{
      release_id:release.id,
      name:`DeltaDesk ${build.label} pro operator`,
      ui_locale:'en-US',
      editorial_locale:'en-US',
      role:'operator',
      plan:'pro',
      region:'CI',
      flags:{advanced_export:true},
      viewport:{width:1280,height:720,scale_milli:1000}
    });
    const scenario=await create('scenario',{
      release_id:release.id,
      name:`DeltaDesk ${build.label} real browser oracle`,
      source_id:source.id,
      target_id:target.id,
      readiness:'declared',
      anchors:[
        {name:'requests',role:'heading',label:'Requests',expected_count:1},
        {name:'checkout',role:'link',label:'Checkout',expected_count:1}
      ],
      steps:[
        {action:'assert',anchor:'requests'},
        {action:'assert',anchor:'checkout'}
      ],
      reset_strategy:'fixture-reset'
    });
    const startedAt=new Date().toISOString();
    const finishedAt=new Date(Date.now()+1).toISOString();
    const stored=(await execute(app,'capture.ingest',{
      release_id:release.id,
      target_id:target.id,
      source_id:source.id,
      scenario_id:scenario.id,
      name:`Semwright Chromium DeltaDesk build ${build.label} evidence`,
      build:build.id,
      classification:'imported',
      rights:'owned',
      started_at:startedAt,
      finished_at:finishedAt,
      receipt:{
        authority:'imported',
        provider:'chromium',
        provider_version:`semwright@${semwrightSha.slice(0,12)}`,
        operation_id:`deltadesk-${key}-semantic-acceptance`,
        profile:'browser.semantic',
        build_observation:build.id,
        outcome:'SUCCEEDED'
      },
      readiness:{
        state:'UNKNOWN',
        checks:[
          {name:'semwright-adapter-execution',state:'PASS',detail:'Exact pinned Chromium adapter completed the semantic oracle.'},
          {name:'platform-job-correlation',state:'UNKNOWN',detail:'Direct CI adapter acceptance intentionally has no Platform job receipt.'},
          {name:'driver-host-isolation',state:'UNKNOWN',detail:'This acceptance does not establish canonical Driver Host isolation.'}
        ]
      },
      anchors:[],
      isolation:{context_id:'deltadesk-ci-owned-fixture',auth_scope:'not-applicable',mutable_state:false},
      cleanup:{policy:'none',created_resource_ids:[],removed_resource_ids:[]},
      provenance:{capture_class:'IMPORTED_UNVERIFIED',synthetic:true,transformations:[]},
      observations:[
        {kind:'semantic-oracle',key:'checkout-cta',value:row.checkout_cta,source:'imported'},
        {kind:'semantic-oracle',key:'basic-operator-export',value:row.basic_operator_export,source:'imported'},
        {kind:'screenshot-sha256',key:row.screenshot.file,value:row.screenshot.sha256,source:'imported'},
        {kind:'driver-receipt-sha256',key:'semwright-deltadesk-driver',value:receiptSha,source:'imported'}
      ]
    })).entity;
    assert.equal(stored.data.capture_contract,'launchwright-capture/2');
    assert.equal(stored.data.provenance.capture_class,'IMPORTED_UNVERIFIED');
    assert.equal(stored.data.admission,'imported-declaration');
    assert.equal(stored.data.technical,'UNKNOWN');
    assert.equal(stored.data.host_acceptance,'NOT_ESTABLISHED');
    assert.equal(stored.data.observed_state_eligible,false);
    admitted.push({
      build:build.id,
      evidence_id:stored.id,
      capture_contract:stored.data.capture_contract,
      admission:stored.data.admission,
      technical:stored.data.technical,
      host_acceptance:stored.data.host_acceptance,
      observed_state_eligible:stored.data.observed_state_eligible
    });
  }

  const evidence={
    schema_version:'launchwright-deltadesk-browser-acceptance/2',
    launchwright_sha:process.env.GITHUB_SHA??null,
    semwright_sha:semwrightSha,
    native_sdk:expectedSdkVersion,
    provider:{id:'chromium',source_pin:expectedSemwrightSha},
    browser:{sha256:browserSha},
    deltadesk:{
      manifest_schema:LAB_MANIFEST.schema_version,
      builds:Object.fromEntries(Object.entries(LAB_MANIFEST.builds).map(([k,v])=>[k,v.id]))
    },
    driver_receipt_sha256:receiptSha,
    screenshots:screenshotEvidence,
    launchwright_capture_records:admitted,
    cross_system_real_browser:true,
    semantic_provider_execution:true,
    platform_receipt_admitted:false,
    canonical_capture_admitted:false,
    driver_host_isolation_accepted:false,
    technical_pass_claimed:false,
    note:'Real DeltaDesk A/B browser execution is preserved in launchwright-capture/2 as IMPORTED_UNVERIFIED. No Platform job receipt, canonical capture admission, Driver Host isolation, or technical PASS is fabricated.'
  };
  mkdirSync('evidence/deltadesk',{recursive:true});
  writeFileSync('evidence/deltadesk/launchwright-deltadesk-browser-acceptance.json',JSON.stringify(evidence,null,2)+'\n');
  process.stdout.write(JSON.stringify(evidence)+'\n');
}finally{
  app.close();
  rmSync(root,{recursive:true,force:true,maxRetries:8,retryDelay:50});
}
