// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync,
  readdirSync, chmodSync, symlinkSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { PNG } from 'pngjs';
import JSZip from 'jszip';
import { execute } from '../src/application.mjs';
import { makeOwnedMaskedDemoFixture } from './masked-demo-fixture.mjs';
import {
  planMaskedInteractiveDemo, exportMaskedInteractiveDemo
} from '../src/masked-interactive-demo.mjs';
import {
  planOfflineHotspots, verifyOfflineHotspots, exportOfflineHotspots
} from '../src/offline-hotspots.mjs';

const worktree=fileURLToPath(new URL('../',import.meta.url));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function fixture(t,opts={}){
  const root=mkdtempSync(join(tmpdir(),'launchwright-r61-owned-'));
  const f=await makeOwnedMaskedDemoFixture(root,opts);
  const r59=planMaskedInteractiveDemo(f.app,f.request);
  const parent=await exportMaskedInteractiveDemo(f.app,r59,f.request,
    f.outputDir,f.confirmation(r59));
  const output=join(root,'hotspot-output');
  mkdirSync(output,{mode:0o700});
  if(process.platform!=='win32')chmodSync(output,0o700);
  t.after(()=>{
    try{f.close();}catch{}
    rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:50});
  });
  const shots=r59.masks.map(m=>m.shot_id);
  const links=[
    {from_shot_id:shots[0],to_shot_id:shots[1],
      label:'Show next captured product state',x:420,y:135,width:90,height:70},
    {from_shot_id:shots[1],to_shot_id:shots[0],
      label:'Return to captured first state',x:420,y:135,width:90,height:70}
  ];
  const options={
    masked_plan:r59,masked_request:f.request,
    source_dir:f.outputDir,links,
    acknowledge_mask_scope_only:true,
    acknowledge_private_only:true
  };
  const confirm=plan=>({
    confirm_plan_sha256:plan.plan_sha256,
    confirm_r59_bundle_sha256:plan.r59_bundle_sha256,
    acknowledge_private_export:true,
    acknowledge_privacy_outside_masks_unknown:true
  });
  return{...f,root,output,r59,parent,links,options,confirm};
}
async function unzip(root,result){
  const bytes=readFileSync(join(root,result.bundle_filename));
  const zip=await JSZip.loadAsync(bytes,{checkCRC32:true});
  const manifest=JSON.parse(await zip.file('manifest.json').async('string'));
  const html=await zip.file('index.html').async('string');
  return{bytes,zip,manifest,html};
}
test('R61 plan is immutable/no-effects, binds exact R59 ZIP, Native Media revision and two masked screen links',async t=>{
  const f=await fixture(t);
  const first=await planOfflineHotspots(f.app,f.options);
  const second=await planOfflineHotspots(f.app,f.options);
  assert.deepEqual(first,second);
  assert.deepEqual(await verifyOfflineHotspots(f.app,first,f.options),first);
  assert.equal(first.r59_plan_sha256,f.r59.plan_sha256);
  assert.equal(first.r59_bundle_sha256,f.parent.bundle_sha256);
  assert.equal(first.r59_media_output_id,f.parent.media_output_id);
  assert.equal(first.frame_count,2);
  assert.deepEqual(first.links,f.links);
  assert.equal(first.technical_state,'UNKNOWN');
  assert.equal(first.native_media_output_created!==undefined,false);
  assert.equal(first.no_native_media_output_created,true);
  assert.equal(first.platform_authority,false);
  assert.equal(f.app.list('media_output').length,1);
  assert.deepEqual(readdirSync(f.output),[]);
  assert.ok(!JSON.stringify(first).includes(f.root));
});
test('R61 standalone derived ZIP validates exact opaque R55 pixels and script-free keyboard accessible links',async t=>{
  const f=await fixture(t);
  const plan=await planOfflineHotspots(f.app,f.options);
  const result=await exportOfflineHotspots(f.app,plan,f.options,f.output,
    f.confirm(plan));
  assert.equal(result.files_created,2);
  assert.equal(result.hotspot_count,2);
  assert.equal(result.native_media_output_created,false);
  assert.equal(result.source_application_actions_executed,false);
  assert.equal(result.external_publication,false);
  assert.equal(result.pixel_privacy_outside_masks_verified,false);
  const {bytes,zip,manifest,html}=await unzip(f.output,result);
  assert.equal(sha(bytes),result.hotspot_zip_sha256);
  assert.deepEqual(Object.keys(zip.files).sort(),['README.txt','index.html','manifest.json']);
  assert.equal(sha(Buffer.from(html)),manifest.html_sha256);
  assert.equal(manifest.r59_bundle_sha256,f.parent.bundle_sha256);
  assert.equal(manifest.r59_media_output_id,f.parent.media_output_id);
  assert.deepEqual(manifest.links,f.links);
  assert.deepEqual(manifest.masked_source_chain,f.r59.masks);
  assert.equal(manifest.navigation_mode,'css-target-links');
  assert.equal(manifest.technical_state,'UNKNOWN');
  assert.equal(manifest.pixel_privacy_outside_masks_verified,false);
  assert.equal(manifest.script_execution,false);
  assert.equal(manifest.source_app_execution,false);
  assert.equal(manifest.network_access,false);
  assert.ok(html.includes("script-src &#39;none&#39;"));
  assert.ok(html.includes("connect-src &#39;none&#39;"));
  assert.ok(html.includes('href="#scene-2"'));
  assert.ok(html.includes('href="#scene-1"'));
  assert.ok(html.includes('class="hotspot"'));
  assert.ok(!/<script\b|<iframe\b|<form\b|https?:\/\//iu.test(html));
  assert.equal((html.match(/<a class="hotspot"/gu)??[]).length,2);
  assert.equal((html.match(/src="data:image\/png;base64/gu)??[]).length,2);
  const images=[...html.matchAll(/src="data:image\/png;base64,([^"]+)"/gu)];
  for(let i=0;i<images.length;i++){
    const png=PNG.sync.read(Buffer.from(images[i][1],'base64'),{checkCRC:true});
    assert.equal(sha(png.data),f.r59.masks[i].masked_pixel_sha256);
  }
  assert.equal(f.app.list('media_output').length,1);
});
test('R61 stable exact bytes across clock boundaries and recovery of interrupted local receipts',async t=>{
  const f=await fixture(t);
  const p=await planOfflineHotspots(f.app,f.options);
  const first=await exportOfflineHotspots(f.app,p,f.options,f.output,f.confirm(p));
  await new Promise(resolve=>setTimeout(resolve,1100));
  const replay=await exportOfflineHotspots(f.app,p,f.options,f.output,f.confirm(p));
  assert.equal(replay.recovered,true);
  assert.equal(replay.files_created,0);
  assert.equal(replay.hotspot_zip_sha256,first.hotspot_zip_sha256);
  rmSync(join(f.output,'launchwright-hotspot-demo-'+p.plan_sha256.slice(0,12)+'.receipt.json'));
  const partial=await exportOfflineHotspots(f.app,p,f.options,f.output,f.confirm(p));
  assert.equal(partial.files_created,1);
  assert.equal(partial.hotspot_zip_sha256,first.hotspot_zip_sha256);
  assert.equal(f.app.list('media_output').length,1);
});
test('R61 tampered plan/changed R59 bytes or edited result fails closed without overwrite',async t=>{
  const f=await fixture(t);
  const p=await planOfflineHotspots(f.app,f.options);
  await assert.rejects(verifyOfflineHotspots(f.app,{...p,links:[]},f.options),
    {code:'Conflict'});
  await assert.rejects(exportOfflineHotspots(f.app,p,f.options,f.output,
    {...f.confirm(p),confirm_r59_bundle_sha256:'f'.repeat(64)}),
    {code:'ConsentRequired'});
  assert.deepEqual(readdirSync(f.output),[]);
  const first=await exportOfflineHotspots(f.app,p,f.options,f.output,f.confirm(p));
  const file=join(f.output,first.bundle_filename);
  writeFileSync(file,Buffer.from('edited owned review bundle'));
  await assert.rejects(exportOfflineHotspots(f.app,p,f.options,f.output,f.confirm(p)),
    {code:'Conflict'});
  assert.equal(readFileSync(file,'utf8'),'edited owned review bundle');
});
test('R61 rejects a hotspot over an R55 privacy mask, undersized targets, out of bounds geometry and fake shots',async t=>{
  const f=await fixture(t);
  const mutate=(link)=>({
    ...f.options,
    links:[{...f.links[0],...link},f.links[1]]
  });
  for(const link of [
    {x:195,y:93,width:60,height:50},
    {x:450,y:200,width:43,height:70},
    {x:450,y:200,width:80,height:43},
    {x:610,y:150,width:90,height:60},
    {x:-1},{to_shot_id:'foreign_shot'},
    {to_shot_id:f.links[0].from_shot_id},
    {label:'bad\nactive'},
    {x:0.5}
  ])await assert.rejects(planOfflineHotspots(f.app,mutate(link)));
  assert.deepEqual(readdirSync(f.output),[]);
});
test('R61 overlap/multiple routes/disconnected states fail rather than ambiguous active areas',async t=>{
  const f=await fixture(t);
  await assert.rejects(planOfflineHotspots(f.app,{
    ...f.options,
    links:[...f.links,{
      ...f.links[0],x:421,y:136,label:'Overlapping alternate route'
    }]
  }),{code:'Conflict'});
  await assert.rejects(planOfflineHotspots(f.app,{
    ...f.options,links:[f.links[1]]
  }),{code:'Conflict'});
  assert.deepEqual(readdirSync(f.output),[]);
});
test('R61 stale R59 Media evidence or a duplicate/changed Native output rejects before output creation',async t=>{
  const f=await fixture(t);
  const p=await planOfflineHotspots(f.app,f.options);
  await execute(f.app,'media.output_record',{
    plan_id:f.r59.media_plan_id,variant_id:f.r59.variant_id,
    state:'SUCCEEDED',authority:'imported',
    provider:'other-noncanonical',provider_version:'1',
    artifact_sha256:'f'.repeat(64),mime:'application/zip',
    observed_at:'2026-10-10T12:00:00.000Z',reported_verification:'UNKNOWN'
  });
  await assert.rejects(exportOfflineHotspots(f.app,p,f.options,f.output,f.confirm(p)),
    {code:'Conflict'});
  assert.deepEqual(readdirSync(f.output),[]);
});
test('R61 enforces strict operator directory/file permissions and stale lock non-clobber',async t=>{
  const f=await fixture(t);
  const p=await planOfflineHotspots(f.app,f.options);
  if(process.platform!=='win32'){
    const exposed=join(f.root,'exposed');
    mkdirSync(exposed,{mode:0o755});chmodSync(exposed,0o755);
    await assert.rejects(exportOfflineHotspots(f.app,p,f.options,exposed,f.confirm(p)),
      {code:'PermissionDenied'});
    const alias=join(f.root,'symlink');
    symlinkSync(f.output,alias);
    await assert.rejects(exportOfflineHotspots(f.app,p,f.options,alias,f.confirm(p)),
      {code:'PermissionDenied'});
  }
  const lock=join(f.app.store.root,'.interactive-demo-apply.lock');
  writeFileSync(lock,'another operator',{mode:0o600});
  await assert.rejects(exportOfflineHotspots(f.app,p,f.options,f.output,f.confirm(p)),
    {code:'Conflict'});
  assert.equal(readFileSync(lock,'utf8'),'another operator');
  assert.deepEqual(readdirSync(f.output),[]);
});
test('R61 unescaped operator label becomes inert text, never a source-app image or script',async t=>{
  const f=await fixture(t);
  const links=[{...f.links[0],label:'<img src=x onerror=alert(1)>'},f.links[1]];
  const args={...f.options,links};
  const p=await planOfflineHotspots(f.app,args);
  const result=await exportOfflineHotspots(f.app,p,args,f.output,f.confirm(p));
  const {html}=await unzip(f.output,result);
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(!html.includes('<img src=x'));
  assert.equal((html.match(/<img /gu)??[]).length,2);
  assert.equal(result.source_application_actions_executed,false);
});


test('R61 two-phase CLI stores private exact plan, rejects blind overwrite, and recovers same ZIP',async t=>{
  const f=await fixture(t);
  const r59PlanPath=join(f.root,'r59-plan.json');
  const r59RequestPath=join(f.root,'r59-request.json');
  const linksPath=join(f.root,'hotspot-links.json');
  const r61PlanPath=join(f.root,'r61-plan.json');
  for(const [file,data] of [
    [r59PlanPath,f.r59],[r59RequestPath,f.request],[linksPath,f.links]
  ])writeFileSync(file,JSON.stringify(data),{mode:0o600});
  const call=args=>spawnSync(process.execPath,['scripts/offline-hotspots.mjs',...args],{
    cwd:worktree,encoding:'utf8',timeout:20000
  });
  const common=['--state',f.app.store.root,
    '--r59-plan',r59PlanPath,'--r59-request',r59RequestPath,
    '--r59-dir',f.outputDir,'--links',linksPath,
    '--acknowledge-mask-scope-only','--acknowledge-private-only'];
  const planArgs=['plan',...common,'--out',r61PlanPath];
  const planned=call(planArgs);
  assert.equal(planned.status,0,planned.stdout+planned.stderr);
  assert.equal(JSON.parse(planned.stdout).workspace_mutated,false);
  const plan=JSON.parse(readFileSync(r61PlanPath,'utf8'));
  assert.equal(plan.r59_bundle_sha256,f.parent.bundle_sha256);
  if(process.platform!=='win32')assert.equal(statSync(r61PlanPath).mode&0o077,0);
  assert.notEqual(call(planArgs).status,0,'Private reviewed plan must not be overwritten');
  const exporting=['export',...common,'--plan',r61PlanPath,
    '--out-dir',f.output,'--confirm-plan',plan.plan_sha256,
    '--confirm-r59',plan.r59_bundle_sha256,
    '--acknowledge-private-export',
    '--acknowledge-privacy-outside-masks-unknown'];
  const denied=call(exporting.map(v=>v===plan.plan_sha256?'f'.repeat(64):v));
  assert.notEqual(denied.status,0);
  assert.deepEqual(readdirSync(f.output),[]);
  const actual=call(exporting);
  assert.equal(actual.status,0,actual.stdout+actual.stderr);
  assert.equal(JSON.parse(actual.stdout).files_created,2);
  const repeated=call(exporting);
  assert.equal(repeated.status,0,repeated.stdout+repeated.stderr);
  assert.equal(JSON.parse(repeated.stdout).recovered,true);
  assert.equal(f.app.list('media_output').length,1);
});
