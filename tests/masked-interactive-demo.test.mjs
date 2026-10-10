// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync}from'node:child_process';
import {fileURLToPath}from'node:url';
import{mkdtempSync,rmSync,readFileSync,writeFileSync,readdirSync,
  mkdirSync,chmodSync,symlinkSync}from'node:fs';
import{tmpdir}from'node:os';
import{join}from'node:path';
import JSZip from 'jszip';
import{PNG}from'pngjs';
import{execute}from'../src/application.mjs';
import{makeOwnedMaskedDemoFixture}from'./masked-demo-fixture.mjs';
import{
  planMaskedInteractiveDemo,verifyMaskedInteractiveDemo,
  exportMaskedInteractiveDemo
}from'../src/masked-interactive-demo.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const repoRoot=fileURLToPath(new URL('../',import.meta.url));
async function fixture(t,opts={}){
  const dir=mkdtempSync(join(tmpdir(),'launchwright-r59-'));
  const f=await makeOwnedMaskedDemoFixture(dir,opts);
  t.after(()=>{try{f.close();}catch{}rmSync(dir,{recursive:true,force:true,maxRetries:6,retryDelay:60});});
  return{...f,root:dir};
}
async function unpack(f,result){
  const raw=readFileSync(join(f.outputDir,result.bundle_filename));
  const zip=await JSZip.loadAsync(raw,{checkCRC32:true});
  return{raw,zip,manifest:JSON.parse(await zip.file('manifest.json').async('string')),
    html:await zip.file('index.html').async('string')};
}
test('R59 exact no-effects plan links every R55 plan, opaque mask and current Native derivative, with zero leaked private paths',async t=>{
  const f=await fixture(t),p=planMaskedInteractiveDemo(f.app,f.request);
  assert.deepEqual(p,planMaskedInteractiveDemo(f.app,f.request));
  assert.deepEqual(p,verifyMaskedInteractiveDemo(f.app,p,f.request));
  assert.equal(p.frame_count,2);
  assert.equal(p.technical_state,'UNKNOWN');
  assert.equal(p.customer_capture_accepted,false);
  assert.equal(p.platform_authority,false);
  assert.equal(p.privacy_outside_masks_verified,false);
  assert.equal(p.masks.length,2);
  assert.equal(f.app.list('media_output').length,0);
  for(let i=0;i<2;i++){
    assert.equal(p.masks[i].derived_evidence_id,
      f.masked_sources[i].mask_receipt.derived_evidence_id);
    assert.equal(p.masks[i].r55_plan_sha256,
      f.masked_sources[i].mask_plan.plan_sha256);
    assert.equal(p.masks[i].masked_pixel_sha256,
      f.masked_sources[i].mask_plan.masked_pixel_sha256);
    assert.equal(p.masks[i].mask_rectangles,2);
    assert.equal(p.masks[i].privacy_outside_masks,'UNKNOWN');
  }
  assert.ok(!JSON.stringify(p).includes(f.root));
  assert.ok(!JSON.stringify(p).includes('frame-1.png'));
  assert.deepEqual(readdirSync(f.outputDir),[]);
});

test('R59 real offline ZIP embeds only masked R55 pixels with exact Native source chain, script-free static navigation',async t=>{
  const f=await fixture(t),p=planMaskedInteractiveDemo(f.app,f.request);
  const result=await exportMaskedInteractiveDemo(f.app,p,f.request,f.outputDir,f.confirmation(p));
  assert.equal(result.files_created,2);
  assert.equal(result.mask_proof_count,2);
  assert.equal(result.media_output_created,true);
  assert.equal(result.technical_state,'UNKNOWN');
  assert.equal(result.independent_privacy_approval,false);
  assert.equal(result.source_application_execution,false);
  assert.equal(result.external_publication,false);
  const{raw,zip,manifest,html}=await unpack(f,result);
  assert.equal(sha(raw),result.bundle_sha256);
  assert.deepEqual(Object.keys(zip.files).sort(),['README.txt','index.html','manifest.json']);
  assert.equal(manifest.r59_masked_demo_schema,'launchwright-r59-masked-interactive-demo/1');
  assert.equal(manifest.r59_plan_sha256,p.plan_sha256);
  assert.equal(manifest.media_plan_digest,p.media_plan_digest);
  assert.deepEqual(manifest.r55_mask_chain,p.masks);
  assert.equal(manifest.pixels_outside_masks_independently_private,false);
  assert.equal(manifest.opaque_mask_pixels_checked,true);
  assert.equal(manifest.script_execution_permitted,false);
  assert.equal(manifest.technical_state,'UNKNOWN');
  assert.equal(manifest.platform_authority,false);
  assert.ok(html.includes('TECHNICAL UNKNOWN'));
  assert.ok(!/<script\b|<iframe\b|https?:\/\//iu.test(html));
  assert.ok(!html.includes(f.root));
  const pngs=[...html.matchAll(/<img src="data:image\/png;base64,([^"]+)"/gu)];
  assert.equal(pngs.length,2);
  for(let i=0;i<pngs.length;i++){
    const pixels=PNG.sync.read(Buffer.from(pngs[i][1],'base64'),{checkCRC:true});
    assert.equal(sha(pixels.data),f.masked_sources[i].mask_plan.masked_pixel_sha256,
      'HTML must contain the exact R55 masked pixel surface');
    const input=PNG.sync.read(readFileSync(f.masked_sources[i].mask_input.source_png_path),
      {checkCRC:true});
    const resultImage=pixels;
    const rectangles=f.masked_sources[i].mask_input.rectangles;
    for(let y=0;y<input.height;y++)for(let x=0;x<input.width;x++){
      const offset=(y*input.width+x)*4;
      const masked=rectangles.some(r=>x>=r.x&&x<r.x+r.width&&y>=r.y&&y<r.y+r.height);
      const actual=[...resultImage.data.subarray(offset,offset+4)];
      const expected=masked?[8,22,33,255]:[...input.data.subarray(offset,offset+4)];
      assert.deepEqual(actual,expected,'R59 pixels must equal R55 output within/outside all masks');
    }
  }
  const native=f.app.get(result.media_output_id,'media_output');
  assert.equal(native.data.provider,'launchwright-r59-masked-offline');
  assert.equal(native.data.technical_effective,'UNKNOWN');
  assert.equal(native.data.admission,'imported-declaration');
  assert.equal(native.data.artifact_sha256,result.bundle_sha256);
});

test('R59 exact replay is byte-stable across time, recovers partial local artifacts and one Native receipt',async t=>{
  const f=await fixture(t),p=planMaskedInteractiveDemo(f.app,f.request);
  const first=await exportMaskedInteractiveDemo(f.app,p,f.request,f.outputDir,f.confirmation(p));
  await new Promise(resolve=>setTimeout(resolve,1050));
  const replay=await exportMaskedInteractiveDemo(f.app,p,f.request,f.outputDir,f.confirmation(p));
  assert.equal(replay.recovered,true);assert.equal(replay.files_created,0);
  assert.equal(replay.bundle_sha256,first.bundle_sha256);
  assert.equal(replay.media_output_id,first.media_output_id);
  const receipt=join(f.outputDir,'launchwright-masked-demo-'+p.plan_sha256.slice(0,12)+'.receipt.json');
  rmSync(receipt);
  const recovered=await exportMaskedInteractiveDemo(f.app,p,f.request,f.outputDir,f.confirmation(p));
  assert.equal(recovered.files_created,1);
  assert.equal(recovered.media_output_created,false);
  assert.equal(f.app.list('media_output').length,1);
});
test('R59 missing or mismatched masks, substituted Native IDs, changed order and wrong rights fail before writes',async t=>{
  const f=await fixture(t),plan=planMaskedInteractiveDemo(f.app,f.request);
  for(const mutation of [
    {...f.request,masked_sources:[f.masked_sources[0]]},
    {...f.request,masked_sources:[f.masked_sources[1],f.masked_sources[0]]},
    {...f.request,demo_input:{...f.request.demo_input,source_rights:'licensed'}},
    {...f.request,masked_sources:f.masked_sources.map((s,i)=>i===0?
      {...s,mask_receipt:{...s.mask_receipt,derived_evidence_id:f.masked_sources[1].mask_receipt.derived_evidence_id}}:s)},
    {...f.request,masked_sources:f.masked_sources.map((s,i)=>i===0?
      {...s,mask_receipt:{...s.mask_receipt,independent_privacy_review:true}}:s)},
    {...f.request,masked_sources:f.masked_sources.map((s,i)=>i===0?
      {...s,mask_receipt:{...s.mask_receipt,external_service_called:true}}:s)},
    {...f.request,masked_sources:f.masked_sources.map((s,i)=>i===0?
      {...s,mask_receipt:{...s.mask_receipt,opaque_mask_fill_rgb:[255,0,0]}}:s)},
    {...f.request,acknowledge_mask_scope_only:false}
  ]){
    assert.throws(()=>planMaskedInteractiveDemo(f.app,mutation));
  }
  assert.throws(()=>verifyMaskedInteractiveDemo(f.app,{...plan,frame_count:3},f.request),{code:'Conflict'});
  assert.deepEqual(readdirSync(f.outputDir),[]);
  assert.equal(f.app.list('media_output').length,0);
});
test('R59 source-checked plan fails on changed R55 original PNG and current Native source version',async t=>{
  const f=await fixture(t),p=planMaskedInteractiveDemo(f.app,f.request);
  const original=f.masked_sources[0].mask_input.source_png_path;
  writeFileSync(original,Buffer.concat([readFileSync(original),Buffer.from([0x01])]));
  assert.throws(()=>planMaskedInteractiveDemo(f.app,f.request),{code:'Conflict'});
  await assert.rejects(exportMaskedInteractiveDemo(f.app,p,f.request,f.outputDir,f.confirmation(p)),
    {code:'Conflict'});
  assert.equal(readdirSync(f.outputDir).length,0);
});
test('R59 a modified authorized Native source revision invalidates Media and R55 lineage before export',async t=>{
  const f=await fixture(t),plan=planMaskedInteractiveDemo(f.app,f.request);
  await execute(f.app,'entity.update',{
    id:f.source.id,expected:f.source.version,
    data:{...f.source.data,purpose:'Changed authorized fixture source after R55 mask'}
  });
  assert.throws(()=>planMaskedInteractiveDemo(f.app,f.request),{code:'StaleReference'});
  await assert.rejects(
    exportMaskedInteractiveDemo(f.app,plan,f.request,f.outputDir,f.confirmation(plan)),
    {code:'StaleReference'});
  assert.deepEqual(readdirSync(f.outputDir),[]);
});

test('R59 conflicting Native output is denied BEFORE local artifact creation',async t=>{
  const f=await fixture(t),p=planMaskedInteractiveDemo(f.app,f.request);
  await execute(f.app,'media.output_record',{
    plan_id:f.plan.id,variant_id:'offline_1',state:'SUCCEEDED',
    authority:'imported',provider:'unrelated-output',provider_version:'v1',
    artifact_sha256:'a'.repeat(64),mime:'application/zip',
    observed_at:'2026-10-10T12:00:00.000Z',reported_verification:'UNKNOWN'
  });
  await assert.rejects(exportMaskedInteractiveDemo(f.app,p,f.request,f.outputDir,f.confirmation(p)),
    {code:'Conflict'});
  assert.deepEqual(readdirSync(f.outputDir),[]);
});
test('R59 changed/unsafe output, lock collision, denied confirmations never clobber a prior result',async t=>{
  const f=await fixture(t),p=planMaskedInteractiveDemo(f.app,f.request);
  for(const denied of [
    {...f.confirmation(p),confirm_plan_sha256:'f'.repeat(64)},
    {...f.confirmation(p),confirm_media_plan_digest:'f'.repeat(64)},
    {...f.confirmation(p),acknowledge_privacy_outside_masks_unknown:false}
  ]){
    await assert.rejects(exportMaskedInteractiveDemo(f.app,p,f.request,f.outputDir,denied),
      {code:'ConsentRequired'});
  }
  assert.deepEqual(readdirSync(f.outputDir),[]);
  const result=await exportMaskedInteractiveDemo(f.app,p,f.request,f.outputDir,f.confirmation(p));
  const path=join(f.outputDir,result.bundle_filename);
  writeFileSync(path,'human modified offline demo');
  await assert.rejects(exportMaskedInteractiveDemo(f.app,p,f.request,f.outputDir,f.confirmation(p)),
    {code:'Conflict'});
  assert.equal(readFileSync(path,'utf8'),'human modified offline demo');
  const lock=join(f.app.store.root,'.interactive-demo-apply.lock');
  writeFileSync(lock,'second operator',{mode:0o600});
  await assert.rejects(exportMaskedInteractiveDemo(f.app,p,f.request,f.outputDir,f.confirmation(p)),
    {code:'Conflict'});
  assert.equal(readFileSync(lock,'utf8'),'second operator');
  if(process.platform!=='win32'){
    const publicDir=join(f.root,'public');
    mkdirSync(publicDir,{mode:0o755});chmodSync(publicDir,0o755);
    await assert.rejects(exportMaskedInteractiveDemo(f.app,p,f.request,publicDir,f.confirmation(p)),
      {code:'PermissionDenied'});
    const link=join(f.root,'redirection');
    symlinkSync(f.outputDir,link);
    await assert.rejects(exportMaskedInteractiveDemo(f.app,p,f.request,link,f.confirmation(p)),
      {code:'PermissionDenied'});
  }
});
test('R59 untrusted labels remain escaped, active JavaScript is forbidden by CSP',async t=>{
  const f=await fixture(t,{maliciousLabel:true}),p=planMaskedInteractiveDemo(f.app,f.request);
  const result=await exportMaskedInteractiveDemo(f.app,p,f.request,f.outputDir,f.confirmation(p));
  const {html,manifest}=await unpack(f,result);
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(!html.includes('<img src=x'));
  assert.equal((html.match(/<img src=/gu)??[]).length,2);
  assert.ok(html.includes('Content-Security-Policy'));
  assert.ok(html.includes('script-src &#39;none&#39;'));
  assert.equal(manifest.source_app_execution_permitted,false);
  assert.equal(manifest.platform_authority,false);
});

test('R59 CLI creates one exclusive private plan; independently typed full digests guard export and exact recovery',async t=>{
  const f=await fixture(t);
  const inputFile=join(f.root,'private-r59-sources.json'),
    planFile=join(f.root,'private-r59-plan.json');
  writeFileSync(inputFile,JSON.stringify(f.request),{mode:0o600});
  const cli=args=>spawnSync(process.execPath,['scripts/masked-interactive-demo.mjs',...args],
    {cwd:repoRoot,encoding:'utf8',timeout:30000});
  const create=['plan','--state',f.app.store.root,
    '--input',inputFile,'--out',planFile];
  const first=cli(create);
  assert.equal(first.status,0,first.stdout+first.stderr);
  const plan=JSON.parse(readFileSync(planFile,'utf8'));
  assert.equal(plan.frame_count,2);
  assert.equal(JSON.parse(first.stdout).workspace_mutated,false);
  assert.notEqual(cli(create).status,0,'Original private intent must not be overwritten');
  const action=['export','--state',f.app.store.root,'--input',inputFile,
    '--plan',planFile,'--out-dir',f.outputDir,
    '--confirm-plan',plan.plan_sha256,
    '--confirm-media',plan.media_plan_digest,
    '--acknowledge-private-export','--acknowledge-remaining-privacy-unknown'];
  const wrong=cli(action.map(s=>s===plan.plan_sha256?'0'.repeat(64):s));
  assert.notEqual(wrong.status,0,'Wrong digest cannot trigger any native/filesystem mutation');
  assert.deepEqual(readdirSync(f.outputDir),[]);
  const applied=cli(action);
  assert.equal(applied.status,0,applied.stdout+applied.stderr);
  const receipt=JSON.parse(applied.stdout);
  assert.equal(receipt.mask_proof_count,2);
  assert.equal(receipt.technical_state,'UNKNOWN');
  const recovered=cli(action);
  assert.equal(recovered.status,0,recovered.stdout+recovered.stderr);
  assert.equal(JSON.parse(recovered.stdout).recovered,true);
  assert.equal(JSON.parse(recovered.stdout).media_output_id,receipt.media_output_id);
});
