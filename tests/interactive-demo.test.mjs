// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, mkdirSync, rmSync, readdirSync, readFileSync,
  writeFileSync, chmodSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { PNG } from 'pngjs';
import { execute } from '../src/application.mjs';
import { makeOwnedInteractiveFixture } from './interactive-fixture.mjs';
import { planInteractiveDemo, verifyInteractiveDemo,
  exportInteractiveDemo } from '../src/interactive-demo.mjs';

const hash=x=>createHash('sha256').update(x).digest('hex');
async function fixture(t,options={}){
  const root=mkdtempSync(join(tmpdir(),'launchwright-r43-tests-'));
  const x=await makeOwnedInteractiveFixture(root,options);
  const dir=join(root,'output');
  mkdirSync(dir,{mode:0o700});if(process.platform!=='win32')chmodSync(dir,0o700);
  t.after(()=>{try{x.close();}catch{}rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:50});});
  const approvals=plan=>({
    confirm_plan_sha256:plan.plan_sha256,
    confirm_media_plan_digest:plan.media_plan_digest,
    acknowledge_private_export:true
  });
  return{...x,root,dir,approvals};
}
async function unpackZip(root,result){
  const zipName=join(root,result.filename);
  const bytes=readFileSync(zipName);
  const zip=await JSZip.loadAsync(bytes,{checkCRC32:true});
  const names=Object.keys(zip.files).sort();
  const html=await zip.file('index.html')?.async('string');
  const manifest=JSON.parse(await zip.file('manifest.json').async('string'));
  return{bytes,zip,names,html,manifest};
}
test('R43 deterministic no-effects plan binds Media variant, complete sanitized shot set and source digests without paths',async t=>{
  const x=await fixture(t);
  const first=planInteractiveDemo(x.app,x.input);
  const second=planInteractiveDemo(x.app,x.input);
  assert.deepEqual(second,first);
  assert.deepEqual(verifyInteractiveDemo(x.app,first,x.input),first);
  assert.equal(first.frame_count,2);
  assert.equal(first.technical_state,'UNKNOWN');
  assert.equal(first.pixel_privacy_independently_verified,false);
  assert.equal(first.media_driver_host_acceptance,false);
  assert.equal(first.external_publish_authority,false);
  assert.equal(x.app.list('media_output').length,0);
  assert.ok(!JSON.stringify(first).includes(x.localRoot));
  assert.ok(!JSON.stringify(first).includes('frame-1.png'));
  assert.match(first.plan_sha256,/^[a-f0-9]{64}$/u);
});
test('R43 real ZIP contains script-free, data-image-only, CSP-bound navigable HTML and exact Media evidence manifest',async t=>{
  const x=await fixture(t),plan=planInteractiveDemo(x.app,x.input);
  const result=await exportInteractiveDemo(x.app,plan,x.input,x.dir,x.approvals(plan));
  assert.equal(result.files_created,2);
  assert.equal(result.media_output_created,true);
  assert.equal(result.technical_state,'UNKNOWN');
  assert.equal(result.platform_authority,false);
  assert.equal(result.external_publication,false);
  assert.equal(result.pixel_privacy_independently_verified,false);
  const {bytes,names,html,manifest}=await unpackZip(x.dir,result);
  assert.deepEqual(names,['README.txt','index.html','manifest.json']);
  assert.equal(hash(bytes),result.artifact_sha256);
  assert.equal(manifest.plan_sha256,plan.plan_sha256);
  assert.equal(manifest.media_plan_digest,plan.media_plan_digest);
  assert.equal(manifest.screenshots.length,2);
  assert.deepEqual(manifest.screenshots.map(s=>s.source_evidence_id),
    x.frames.map(s=>s.source_evidence_id));
  assert.equal(manifest.network_access_performed,false);
  assert.equal(manifest.pixel_privacy_independently_verified,false);
  assert.equal(manifest.script_execution_permitted,false);
  assert.equal(hash(Buffer.from(html)),manifest.html_sha256);
  assert.ok(html.includes("script-src &#39;none&#39;"));
  assert.ok(html.includes("connect-src &#39;none&#39;"));
  assert.ok(html.includes('data:image/png;base64,'));
  assert.ok(!/<script\b|<iframe\b|https?:\/\//iu.test(html));
  assert.ok(!html.includes(x.localRoot));
  assert.ok(!html.includes('platform_job_id'));
  assert.equal((html.match(/<section class="frame"/gu)??[]).length,2);
  assert.equal((html.match(/type="radio"/gu)??[]).length,2);
  const entity=x.app.get(result.media_output_id,'media_output');
  assert.equal(entity.data.variant_id,'offline_1');
  assert.equal(entity.data.technical_effective,'UNKNOWN');
  assert.equal(entity.data.admission,'imported-declaration');
  assert.equal(entity.data.artifact_sha256,result.artifact_sha256);
  // Embedded PNG data URI is a real decodable source-normalized pixel surface.
  const match=html.match(/src="data:image\/png;base64,([^"]+)"/u);
  assert.ok(match);
  const decoded=PNG.sync.read(Buffer.from(match[1],'base64'),{checkCRC:true});
  assert.equal(decoded.width,640);assert.equal(decoded.height,360);
});
test('R43 repeated ZIP is byte-stable, native Media output reconciles, partial private files safely recover',async t=>{
  const x=await fixture(t),plan=planInteractiveDemo(x.app,x.input);
  const first=await exportInteractiveDemo(x.app,plan,x.input,x.dir,x.approvals(plan));
  await new Promise(resolve=>setTimeout(resolve,1200));
  const again=await exportInteractiveDemo(x.app,plan,x.input,x.dir,x.approvals(plan));
  assert.equal(again.artifact_sha256,first.artifact_sha256);
  assert.equal(again.media_output_id,first.media_output_id);
  assert.equal(again.files_created,0);
  assert.equal(again.recovered,true);
  assert.equal(x.app.list('media_output').length,1);
  const receipt=join(x.dir,'launchwright-demo-'+plan.plan_sha256.slice(0,12)+'.receipt.json');
  rmSync(receipt);
  const recovery=await exportInteractiveDemo(x.app,plan,x.input,x.dir,x.approvals(plan));
  assert.equal(recovery.files_created,1);
  assert.equal(recovery.media_output_created,false);
  assert.equal(recovery.artifact_sha256,first.artifact_sha256);
  assert.equal(x.app.list('media_output').length,1);
});
test('R43 source PNG digest tampering fails before effects; denied consents and altered plans cannot create output',async t=>{
  const x=await fixture(t),plan=planInteractiveDemo(x.app,x.input);
  assert.throws(()=>verifyInteractiveDemo(x.app,{...plan,width:500},x.input),{code:'Conflict'});
  await assert.rejects(exportInteractiveDemo(x.app,plan,x.input,x.dir,{
    ...x.approvals(plan),confirm_plan_sha256:'a'.repeat(64)
  }),{code:'ConsentRequired'});
  await assert.rejects(exportInteractiveDemo(x.app,plan,x.input,x.dir,{
    ...x.approvals(plan),acknowledge_private_export:false
  }),{code:'ConsentRequired'});
  assert.throws(()=>planInteractiveDemo(x.app,{...x.input,acknowledge_pixel_privacy:false}),{code:'ConsentRequired'});
  assert.throws(()=>planInteractiveDemo(x.app,{...x.input,acknowledge_private_only:false}),{code:'ConsentRequired'});
  assert.throws(()=>planInteractiveDemo(x.app,{
    ...x.input,frames:x.input.frames.map((f,i)=>i===0?{...f,png_sha256:'f'.repeat(64)}:f)
  }),{code:'Conflict'});
  assert.deepEqual(readdirSync(x.dir),[]);
  assert.equal(x.app.list('media_output').length,0);
});
test('R43 foreign derivative, frame order, incomplete shots and false rights fail closed',async t=>{
  const x=await fixture(t);
  for(const mutation of [
    {...x.input,frames:[x.input.frames[1],x.input.frames[0]]},
    {...x.input,frames:[x.input.frames[0]]},
    {...x.input,source_rights:'licensed'},
    {...x.input,frames:x.input.frames.map((f,i)=>i===0?{
      ...f,source_evidence_id:x.input.frames[1].source_evidence_id
    }:f)}
  ])assert.throws(()=>planInteractiveDemo(x.app,mutation));
  assert.equal(x.app.list('media_output').length,0);
});
test('R43 unsafe output directory, changed private ZIP and stale operator lock never clobber artifacts',async t=>{
  const x=await fixture(t),plan=planInteractiveDemo(x.app,x.input);
  const result=await exportInteractiveDemo(x.app,plan,x.input,x.dir,x.approvals(plan));
  const zipPath=join(x.dir,result.filename);
  writeFileSync(zipPath,'human edited previous result');
  await assert.rejects(exportInteractiveDemo(x.app,plan,x.input,x.dir,x.approvals(plan)),
    {code:'Conflict'});
  assert.equal(readFileSync(zipPath,'utf8'),'human edited previous result');
  if(process.platform!=='win32'){
    const publicDir=join(x.root,'world-readable');
    mkdirSync(publicDir,{mode:0o755});chmodSync(publicDir,0o755);
    await assert.rejects(exportInteractiveDemo(x.app,plan,x.input,publicDir,x.approvals(plan)),
      {code:'PermissionDenied'});
    const symlink=join(x.root,'malicious-output-symlink');
    symlinkSync(x.dir,symlink);
    await assert.rejects(exportInteractiveDemo(x.app,plan,x.input,symlink,x.approvals(plan)),
      {code:'PermissionDenied'});
  }
  const lock=join(x.app.store.root,'.interactive-demo-apply.lock');
  writeFileSync(lock,'other operator',{mode:0o600});
  await assert.rejects(exportInteractiveDemo(x.app,plan,x.input,x.dir,x.approvals(plan)),
    {code:'Conflict'});
  assert.equal(readFileSync(lock,'utf8'),'other operator');
});
test('R43 duplicate existing Native media output conflicting bytes is rejected before any file write',async t=>{
  const x=await fixture(t),plan=planInteractiveDemo(x.app,x.input);
  await execute(x.app,'media.output_record',{
    plan_id:x.plan.id,variant_id:'offline_1',
    state:'SUCCEEDED',authority:'imported',
    provider:'other-declaration',provider_version:'fixture',
    artifact_sha256:'a'.repeat(64),mime:'application/zip',
    observed_at:'2026-10-09T12:00:00.000Z',reported_verification:'UNKNOWN'
  });
  await assert.rejects(exportInteractiveDemo(x.app,plan,x.input,x.dir,x.approvals(plan)),
    {code:'Conflict'});
  assert.deepEqual(readdirSync(x.dir),[]);
});
test('R43 source Media plan revision causes stale source on both planning and applying',async t=>{
  const x=await fixture(t),plan=planInteractiveDemo(x.app,x.input);
  await execute(x.app,'entity.update',{id:x.scenario.id,expected:x.scenario.version,
    data:{...x.scenario.data,name:'Changed pinned scenario version'}});
  assert.throws(()=>planInteractiveDemo(x.app,x.input),{code:'StaleReference'});
  await assert.rejects(exportInteractiveDemo(x.app,plan,x.input,x.dir,x.approvals(plan)),
    {code:'StaleReference'});
  assert.deepEqual(readdirSync(x.dir),[]);
});
test('R43 malicious operator label is escaped into static HTML and never creates an active image/script',async t=>{
  const x=await fixture(t,{maliciousLabel:true}),plan=planInteractiveDemo(x.app,x.input);
  const result=await exportInteractiveDemo(x.app,plan,x.input,x.dir,x.approvals(plan));
  const {html}=await unpackZip(x.dir,result);
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(!html.includes('<img src=x'));
  assert.equal((html.match(/<img /gu)??[]).length,2);
  assert.ok(html.includes('Content-Security-Policy'));
  assert.ok(!html.includes('document.cookie'));
  assert.equal(result.source_application_scripts_executed,false);
});


test('R43 operator CLI creates one private no-effects plan, confirms original Media digest and recoveries exact ZIP',async t=>{
  const x=await fixture(t);
  const privateSelection=join(x.root,'private-screenshot-selection.json');
  const privatePlan=join(x.root,'private-interactive-plan.json');
  writeFileSync(privateSelection,JSON.stringify(x.input),{mode:0o600,flag:'wx'});
  const root=fileURLToPath(new URL('../',import.meta.url));
  const cli=args=>spawnSync(process.execPath,['scripts/interactive-demo.mjs',...args],
    {cwd:root,encoding:'utf8',timeout:20000});
  const first=cli(['plan','--state',x.app.store.root,
    '--input',privateSelection,'--out',privatePlan]);
  assert.equal(first.status,0,first.stdout+first.stderr);
  const plan=JSON.parse(readFileSync(privatePlan,'utf8'));
  assert.equal(plan.frame_count,2);
  assert.equal(JSON.parse(first.stdout).workspace_mutated,false);
  assert.ok(!JSON.stringify(plan).includes(x.localRoot));
  assert.deepEqual(readdirSync(x.dir),[]);
  assert.notEqual(cli(['plan','--state',x.app.store.root,
    '--input',privateSelection,'--out',privatePlan]).status,0,
    'Saved operator plan must not be silently overwritten');
  const approval=['export','--state',x.app.store.root,
    '--input',privateSelection,'--plan',privatePlan,'--out-dir',x.dir,
    '--confirm-plan',plan.plan_sha256,
    '--confirm-media',plan.media_plan_digest,
    '--acknowledge-private-export'];
  const firstExport=cli(approval);
  assert.equal(firstExport.status,0,firstExport.stdout+firstExport.stderr);
  const receipt=JSON.parse(firstExport.stdout);
  assert.equal(receipt.files_created,2);
  assert.equal(receipt.platform_authority,false);
  const recovery=cli(approval);
  assert.equal(recovery.status,0,recovery.stdout+recovery.stderr);
  assert.equal(JSON.parse(recovery.stdout).recovered,true);
  assert.equal(JSON.parse(recovery.stdout).files_created,0);
  assert.equal(x.app.list('media_output').length,1);
});
