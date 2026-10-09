// SPDX-License-Identifier: AGPL-3.0-only
// R44 store-specific owned synthetic fixture, real PNG, ZIP and Native SDK.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync,spawnSync } from 'node:child_process';
import { mkdtempSync,mkdirSync,rmSync,readFileSync,writeFileSync,
  readdirSync,chmodSync,statSync,symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { PNG } from 'pngjs';
import { execute } from '../src/application.mjs';
import { makeOwnedStoreFixture } from './store-fixture.mjs';
import {planStorePackage,verifyStorePackage,exportStorePackage}
  from '../src/store-package.mjs';
const SHA=bytes=>createHash('sha256').update(bytes).digest('hex');
const codeRoot=fileURLToPath(new URL('../',import.meta.url));
async function fixture(t,platform='apple-iphone-dynamic-island-medium',options={}){
  const root=mkdtempSync(join(tmpdir(),'launchwright-r44-store-'));
  const f=await makeOwnedStoreFixture(root,{platform,...options});
  const out=join(root,'private');
  mkdirSync(out,{mode:0o700});
  if(process.platform!=='win32')chmodSync(out,0o700);
  t.after(()=>{try{f.close();}catch{}rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:50});});
  const approve=plan=>({
    confirm_plan_sha256:plan.plan_sha256,
    confirm_candidate_sha256:plan.candidate_sha256,
    acknowledge_private_export:true
  });
  return {...f,root,out,approve};
}
async function unpack(x,result){
  const bytes=readFileSync(join(x.out,result.filename));
  const zip=await JSZip.loadAsync(bytes,{checkCRC32:true});
  const manifest=JSON.parse(await zip.file('manifest.json').async('string'));
  const listing=JSON.parse(await zip.file('listing.json').async('string'));
  const preview=await zip.file('preview.html').async('string');
  return{bytes,zip,manifest,listing,preview,names:Object.keys(zip.files).sort()};
}
test('R44 Apple iPhone Dynamic Island medium creates exact approved 1179x2556 24-bit screenshot, private listing and offline preview',async t=>{
  const x=await fixture(t,'apple-iphone-dynamic-island-medium',{screenshotCount:1});
  const plan=planStorePackage(x.app,x.input);
  assert.deepEqual(verifyStorePackage(x.app,plan,x.input),plan);
  assert.equal(plan.screenshot_count,1);
  assert.equal(plan.device,'iphone-dynamic-island-medium');
  assert.equal(plan.build,x.b.release.data.build);
  assert.equal(plan.store_api_upload_performed,false);
  assert.equal(plan.independent_pixel_privacy_pass,false);
  assert.equal(plan.pixel_capture_authority,'operator-declared-sanitized-derivative');
  assert.equal(x.app.list('channel_delivery').length,0,'Planning must not create channel resources');
  const receipt=await exportStorePackage(x.app,plan,x.input,x.out,x.approve(plan));
  assert.equal(receipt.files_created,2);
  assert.equal(receipt.local_png_policy_checks_passed,true);
  assert.equal(receipt.store_api_upload_performed,false);
  assert.equal(receipt.publication_authority,false);
  const bundle=await unpack(x,receipt);
  assert.deepEqual(bundle.names,
    ['README.txt','listing.json','manifest.json','preview.html','screenshots/01.png']);
  assert.equal(SHA(bundle.bytes),receipt.zip_sha256);
  assert.equal(bundle.manifest.release_build,x.b.release.data.build);
  assert.equal(bundle.manifest.candidate_sha256,x.candidate.data.candidate_sha256);
  assert.equal(bundle.manifest.store_policy_complete,false);
  assert.equal(bundle.manifest.source_pixel_authenticity,'operator-declaration-only');
  assert.equal(bundle.listing.app_name,'Owned Synthetic Product');
  assert.equal(bundle.listing.external_submission_state,'NOT_SENT');
  assert.equal(bundle.preview.includes('script-src &#39;none&#39;'),true);
  assert.ok(!bundle.preview.includes('<script'));
  assert.ok(!bundle.preview.includes(x.root));
  const png=await bundle.zip.file('screenshots/01.png').async('nodebuffer');
  assert.equal(png.readUInt8(25),2,'Store screenshot must have no alpha channel');
  assert.equal(PNG.sync.read(png).width,1179);
  assert.equal(PNG.sync.read(png).height,2556);
  assert.equal(SHA(png),bundle.manifest.screenshot_assets[0].normalized_png_sha256);
});
test('R44 Google Play package includes opaque 24-bit screenshots/feature plus 32-bit app icon (alpha allowed)',async t=>{
  const x=await fixture(t,'google-play-phone-portrait');
  const plan=planStorePackage(x.app,x.input);
  assert.equal(plan.device,'phone-portrait');
  assert.equal(plan.screenshot_count,2);
  assert.deepEqual(plan.graphics.map(g=>g.role),['icon','feature']);
  const receipt=await exportStorePackage(x.app,plan,x.input,x.out,x.approve(plan));
  const bundle=await unpack(x,receipt);
  assert.equal(bundle.manifest.google_play_4_screenshot_promotion_recommendation,'NOT_ESTABLISHED');
  assert.equal(bundle.listing.summary,'A clear, source-bound demo');
  assert.ok(bundle.names.includes('graphics/feature.png'));
  assert.ok(bundle.names.includes('graphics/icon.png'));
  assert.ok(bundle.names.includes('screenshots/02.png'));
  const icon=await bundle.zip.file('graphics/icon.png').async('nodebuffer');
  const feature=await bundle.zip.file('graphics/feature.png').async('nodebuffer');
  const screenshot=await bundle.zip.file('screenshots/01.png').async('nodebuffer');
  assert.equal(icon[25],6,'Google Play icon MUST contain a 32-bit alpha channel');
  assert.equal(feature[25],2,'Google feature graphic must have no alpha');
  assert.equal(screenshot[25],2,'Google screenshot must have no alpha');
  assert.equal(PNG.sync.read(icon).width,512);
  assert.equal(PNG.sync.read(feature).height,500);
  assert.equal(PNG.sync.read(screenshot).width,1080);
  assert.ok(icon.length<=1024*1024);
  assert.equal(bundle.manifest.store_account_accepted,false);
  assert.equal(bundle.manifest.app_binary_included,false);
});
test('R44 deterministic ZIP, same-plan exact receipt recovery, interrupted output completion',async t=>{
  const x=await fixture(t,'apple-iphone-dynamic-island-medium',{screenshotCount:1});
  const plan=planStorePackage(x.app,x.input);
  const first=await exportStorePackage(x.app,plan,x.input,x.out,x.approve(plan));
  await new Promise(resolve=>setTimeout(resolve,1120));
  const second=await exportStorePackage(x.app,plan,x.input,x.out,x.approve(plan));
  assert.equal(second.zip_sha256,first.zip_sha256);
  assert.equal(second.files_created,0);
  assert.equal(second.recovered,true);
  const receiptName='launchwright-store-'+plan.plan_sha256.slice(0,12)+'.receipt.json';
  rmSync(join(x.out,receiptName));
  const recovered=await exportStorePackage(x.app,plan,x.input,x.out,x.approve(plan));
  assert.equal(recovered.files_created,1);
  assert.equal(recovered.zip_sha256,first.zip_sha256);
  assert.equal(x.app.list('channel_delivery').length,0);
});
test('R44 rejects transparent screenshots, invalid sizes and tampered pixels rather than changing source images',async t=>{
  const clear=await fixture(t,'apple-iphone-dynamic-island-medium',{
    screenshotCount:1,transparentScreen:true
  });
  assert.throws(()=>planStorePackage(clear.app,clear.input),{code:'InvalidArgument'});
  const x=await fixture(t,'apple-iphone-dynamic-island-medium',{screenshotCount:1});
  const wrong={...x.input,screenshots:x.input.screenshots.map(s=>({
    ...s,png:{...s.png,sha256:'a'.repeat(64)}
  }))};
  assert.throws(()=>planStorePackage(x.app,wrong),{code:'Conflict'});
  const file=x.input.screenshots[0].png.path;
  const bytes=readFileSync(file);
  const original=PNG.sync.read(bytes);
  const resized=PNG.sync.write({width:750,height:original.height,data:
    Buffer.alloc(750*original.height*4,255)},{colorType:6,inputColorType:6});
  const mismatch={...x.input,screenshots:[{...x.input.screenshots[0],
    png:{path:file,sha256:SHA(resized)}}]};
  writeFileSync(file,resized);
  assert.throws(()=>planStorePackage(x.app,mismatch),{code:'Conflict'});
  assert.deepEqual(readdirSync(x.out),[]);
});
test('R44 platform metadata length/policy, privacy/rights acknowledgements, and extra user fields fail closed',async t=>{
  const x=await fixture(t,'apple-iphone-dynamic-island-medium',{screenshotCount:1});
  for(const patch of [
    {metadata:{...x.input.metadata,name:'x'.repeat(31)}},
    {metadata:{...x.input.metadata,summary:'x'.repeat(31)}},
    {metadata:{...x.input.metadata,keywords:'x'.repeat(101)}},
    {metadata:{...x.input.metadata,privacy_policy_url:'http://example.invalid/privacy'}},
    {metadata:{...x.input.metadata,description:'<script>alert(1)</script>'}},
    {source_rights:'unknown'},
    {acknowledge_private_only:false},
    {acknowledge_source_rights:false},
    {acknowledge_pixel_privacy:false},
    {unknown_key:'unapproved'}
  ])assert.throws(()=>planStorePackage(x.app,{...x.input,...patch}));
  assert.deepEqual(readdirSync(x.out),[]);
});
test('R44 exact scoped sanitized capture, owner rights, candidate and channel revision required',async t=>{
  const x=await fixture(t,'apple-iphone-dynamic-island-medium',{screenshotCount:1});
  const plan=planStorePackage(x.app,x.input);
  const wrong={...x.input,source_rights:'licensed'};
  assert.throws(()=>planStorePackage(x.app,wrong),{code:'PermissionDenied'});
  const duplicate={...x.input,screenshots:[x.input.screenshots[0],x.input.screenshots[0]]};
  assert.throws(()=>planStorePackage(x.app,duplicate),{code:'Conflict'});
  await execute(x.app,'entity.update',{
    id:x.channel.id,expected:x.channel.version,
    data:{...x.channel.data,name:'Renamed store destination'}
  });
  assert.throws(()=>verifyStorePackage(x.app,plan,x.input));
  assert.deepEqual(readdirSync(x.out),[]);
});
test('R44 mismatched existing files, unsafe directory, symlink and previous writer lock never overwrite',async t=>{
  const x=await fixture(t,'apple-iphone-dynamic-island-medium',{screenshotCount:1});
  const plan=planStorePackage(x.app,x.input);
  const result=await exportStorePackage(x.app,plan,x.input,x.out,x.approve(plan));
  const zip=join(x.out,result.filename);
  writeFileSync(zip,'human-edited output');
  await assert.rejects(exportStorePackage(x.app,plan,x.input,x.out,x.approve(plan)),{code:'Conflict'});
  assert.equal(readFileSync(zip,'utf8'),'human-edited output');
  if(process.platform!=='win32'){
    const other=join(x.root,'unsafe-public');
    mkdirSync(other,{mode:0o755});chmodSync(other,0o755);
    await assert.rejects(exportStorePackage(x.app,plan,x.input,other,x.approve(plan)),{code:'PermissionDenied'});
    const symlink=join(x.root,'symlink-out');symlinkSync(x.out,symlink);
    await assert.rejects(exportStorePackage(x.app,plan,x.input,symlink,x.approve(plan)),{code:'PermissionDenied'});
  }
  const lock=join(x.app.store.root,'.store-package-apply.lock');
  writeFileSync(lock,'another exporter',{mode:0o600});
  await assert.rejects(exportStorePackage(x.app,plan,x.input,x.out,x.approve(plan)),{code:'Conflict'});
  assert.equal(readFileSync(lock,'utf8'),'another exporter');
});
test('R44 operator CLI prepares one private file and exports only with separate digest approvals',async t=>{
  const x=await fixture(t,'apple-iphone-dynamic-island-medium',{screenshotCount:1});
  const inputFile=join(x.root,'store-input.json'),planFile=join(x.root,'store-plan.json');
  writeFileSync(inputFile,JSON.stringify(x.input),{flag:'wx',mode:0o600});
  const cli=argv=>spawnSync(process.execPath,['scripts/store-package.mjs',...argv],
    {cwd:codeRoot,encoding:'utf8',timeout:20000});
  const planned=cli(['plan','--state',x.app.store.root,'--input',inputFile,'--out',planFile]);
  assert.equal(planned.status,0,planned.stdout+planned.stderr);
  const plan=JSON.parse(readFileSync(planFile,'utf8'));
  assert.equal(JSON.parse(planned.stdout).file_mutations_performed,false);
  if(process.platform!=='win32')assert.equal(statSync(planFile).mode&0o077,0);
  assert.notEqual(cli(['plan','--state',x.app.store.root,'--input',inputFile,'--out',planFile]).status,0);
  const no=cli(['export','--state',x.app.store.root,'--input',inputFile,
    '--plan',planFile,'--out-dir',x.out,
    '--confirm-plan',plan.plan_sha256,'--confirm-candidate',plan.candidate_sha256]);
  assert.notEqual(no.status,0);
  assert.deepEqual(readdirSync(x.out),[]);
  const approved=['export','--state',x.app.store.root,'--input',inputFile,'--plan',planFile,
    '--out-dir',x.out,'--confirm-plan',plan.plan_sha256,
    '--confirm-candidate',plan.candidate_sha256,'--acknowledge-private-export'];
  const exported=cli(approved);
  assert.equal(exported.status,0,exported.stdout+exported.stderr);
  assert.equal(JSON.parse(exported.stdout).files_created,2);
  assert.equal(cli(approved).status,0);
  assert.equal(readdirSync(x.out).length,2);
});
