// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync,rmSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import JSZip from 'jszip';
import {setup} from './helpers.mjs';
import {createR67Fixture} from './continuity-r67-fixture.mjs';
import {createAppServer} from '../src/server.mjs';
import {LaunchwrightClient} from '../client/index.mjs';
import {execute} from '../src/application.mjs';
const OWNER='synthetic-r67-owned-session-token';
const CONSUMER='synthetic-r67-consumer-auth-token';
const sha=x=>createHash('sha256').update(x).digest('hex');
const baseFolder=root=>join(root,'.local-continuity-exports');
const makeAuth=token=>({Authorization:'Bearer '+token,'Content-Type':'application/json'});
const confirm=plan=>({
  confirm_plan_sha256:plan.plan_sha256,
  confirm_before_candidate_sha256:plan.before_candidate_sha256,
  confirm_after_candidate_sha256:plan.after_candidate_sha256,
  acknowledge_private_export:true
});
async function fixture(t){
  const{app,root}=setup(t);
  const product=await createR67Fixture(app);
  const service=createAppServer(app,{port:0,token:OWNER,bearerPrincipals:[
    {token:CONSUMER,principal:'r67-consumer',scopes:['consume']}
  ]});
  const origin=await service.listen();
  t.after(()=>service.close());
  return{app,root,product,service,origin,
    client:new LaunchwrightClient({baseUrl:origin,token:OWNER})};
}
async function post(origin,path,body,token=OWNER,headers={}){
  return fetch(origin+path,{method:'POST',headers:{...makeAuth(token),...headers},
    body:JSON.stringify(body)});
}

test('R67 plan is deterministic, Native-backed and has zero mutations/files',async t=>{
  const f=await fixture(t),count=f.app.store.all().length;
  const first=await f.client.planLocalContinuity(f.product.selection);
  const second=await f.client.planLocalContinuity(f.product.selection);
  assert.deepEqual(first,second);
  assert.match(first.plan_sha256,/^[a-f0-9]{64}$/);
  assert.equal(first.changed_artifacts,1);
  assert.equal(first.private_only,true);
  assert.equal(first.platform_authority,false);
  assert.equal(f.app.store.all().length,count);
  assert.equal(existsSync(baseFolder(f.root)),false);
  assert.ok(!JSON.stringify(first).includes('127.0.0.1:4320'));
});

test('R67 server denies consumers, unauthed and cross-origin clients on every action',async t=>{
  const f=await fixture(t),selection=f.product.selection;
  for(const token of [CONSUMER,'wrong']){
    assert.equal((await post(f.origin,'/api/v1/local-continuity/plan',selection,token)).status,403);
    assert.equal((await post(f.origin,'/api/v1/local-continuity/export',{plan:{}},token)).status,403);
  }
  assert.equal((await post(f.origin,'/api/v1/local-continuity/plan',selection,OWNER,
    {Origin:'https://external.example.invalid'})).status,403);
  const plan=await f.client.planLocalContinuity(selection);
  for(const path of ['/status','/bundle.zip']){
    const url=f.client.continuityBundleUrl(plan.plan_sha256).replace('/bundle.zip',path);
    assert.equal((await fetch(url,{headers:makeAuth(CONSUMER)})).status,403);
    assert.equal((await fetch(url)).status,403);
  }
  assert.equal(existsSync(baseFolder(f.root)),false);
});

test('R67 wrong consent, body fields, substitutions and missing candidates fail before writing',async t=>{
  const f=await fixture(t),plan=await f.client.planLocalContinuity(f.product.selection);
  const invalid=async body=>(await post(f.origin,'/api/v1/local-continuity/export',body)).status;
  assert.equal(await invalid({plan,...confirm(plan),acknowledge_private_export:false}),403);
  assert.equal(await invalid({plan,...confirm(plan),confirm_plan_sha256:'a'.repeat(64)}),403);
  assert.equal(await invalid({plan,...confirm(plan),arbitrary_path:'/tmp/attacker'}),400);
  assert.equal((await post(f.origin,'/api/v1/local-continuity/plan',{
    ...f.product.selection,filesystem_path:'/tmp/private'
  })).status,400);
  assert.equal((await post(f.origin,'/api/v1/local-continuity/plan',{
    ...f.product.selection,acknowledge_incomplete_coverage:false
  })).status,403);
  assert.equal(existsSync(baseFolder(f.root)),false);
});

test('R67 actual private ZIP, checksum, Native provenance, GET download and persisted recovery',async t=>{
  const f=await fixture(t),plan=await f.client.planLocalContinuity(f.product.selection);
  const before=(await f.client.continuityStatus(plan.plan_sha256));
  assert.equal(before.state,'ABSENT');
  const result=await f.client.exportLocalContinuity(plan,confirm(plan));
  assert.equal(result.files_created,2);
  assert.equal(result.technical_state,'UNKNOWN');
  assert.equal(result.external_send_performed,false);
  assert.equal(result.customer_acceptance,false);
  const status=await f.client.continuityStatus(plan.plan_sha256);
  assert.equal(status.state,'READY');
  assert.equal(status.zip_sha256,result.zip_sha256);
  const res=await fetch(f.client.continuityBundleUrl(plan.plan_sha256),{
    headers:{Authorization:'Bearer '+OWNER}
  });
  assert.equal(res.status,200);
  assert.equal(res.headers.get('cache-control'),'no-store');
  assert.equal(res.headers.get('content-type'),'application/zip');
  const bytes=Buffer.from(await res.arrayBuffer());
  assert.equal(sha(bytes),result.zip_sha256);
  const zip=await JSZip.loadAsync(bytes,{checkCRC32:true});
  assert.deepEqual(Object.keys(zip.files).sort(),['README.txt','index.html','report.json']);
  const report=JSON.parse(await zip.file('report.json').async('string'));
  assert.equal(report.technical_behavior_verified,false);
  assert.equal(report.platform_publish_authority,false);
  assert.equal(report.before.candidate_sha256,plan.before_candidate_sha256);
  assert.equal(report.after.candidate_sha256,plan.after_candidate_sha256);
  const saved=readFileSync(join(baseFolder(f.root),result.filename));
  const replay=await f.client.exportLocalContinuity(plan,confirm(plan));
  assert.equal(replay.files_created,0);
  assert.equal(replay.recovered,true);
  assert.deepEqual(saved,readFileSync(join(baseFolder(f.root),result.filename)));
  // Recovery does not require a still-live server instance or browser plan.
  const other=createAppServer(f.app,{port:0,token:OWNER});
  const otherUrl=await other.listen();
  t.after(()=>other.close());
  const recovered=new LaunchwrightClient({baseUrl:otherUrl,token:OWNER});
  assert.equal((await recovered.continuityStatus(plan.plan_sha256)).zip_sha256,result.zip_sha256);
});

test('R67 source drift blocks export even with previously approved plan',async t=>{
  const f=await fixture(t),plan=await f.client.planLocalContinuity(f.product.selection);
  const d=f.product.doc;
  await execute(f.app,'entity.update',{id:d.id,expected:d.version,
    data:{...d.data,content:'Human change after candidate was frozen'}});
  const res=await post(f.origin,'/api/v1/local-continuity/export',
    {plan,...confirm(plan)});
  assert.equal(res.status,409);
  assert.equal((await f.client.continuityStatus(plan.plan_sha256)).state,'ABSENT');
  assert.equal(f.app.list('candidate').length,2);
});

test('R67 tampered stored ZIP and symlinks cannot be downloaded or silently overwritten',async t=>{
  const f=await fixture(t),plan=await f.client.planLocalContinuity(f.product.selection);
  const result=await f.client.exportLocalContinuity(plan,confirm(plan));
  const path=join(baseFolder(f.root),result.filename);
  writeFileSync(path,Buffer.from('tampered'),{mode:0o600});
  await assert.rejects(f.client.continuityStatus(plan.plan_sha256),{code:'Conflict'});
  await assert.rejects(f.client.exportLocalContinuity(plan,confirm(plan)),{code:'Conflict'});
  if(process.platform==='win32')return; // GitHub Windows runners need not permit symlink creation.
  rmSync(path);
  const target=join(f.root,'private-do-not-read');
  writeFileSync(target,'owned secret',{mode:0o600});
  symlinkSync(target,path);
  const url=f.client.continuityBundleUrl(plan.plan_sha256);
  const res=await fetch(url,{headers:{Authorization:'Bearer '+OWNER}});
  assert.equal(res.status,409);
  assert.ok(!JSON.stringify(await res.json()).includes('owned secret'));
});
