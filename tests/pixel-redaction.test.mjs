// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync,mkdirSync,chmodSync,readFileSync,writeFileSync,
  readdirSync,rmSync,symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import JSZip from 'jszip';
import { PNG } from 'pngjs';
import { execute } from '../src/application.mjs';
import { makeOwnedInteractiveFixture } from './interactive-fixture.mjs';
import {
  preparePixelMask,verifyPixelMask,applyPixelMask,withPixelMaskLock
} from '../src/pixel-redaction.mjs';
import {
  planInteractiveDemo,exportInteractiveDemo
} from '../src/interactive-demo.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const workingRoot=fileURLToPath(new URL('../',import.meta.url));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function fixture(t){
  const root=mkdtempSync(join(tmpdir(),'launchwright-r55-owned-'));
  const f=await makeOwnedInteractiveFixture(root);
  const output=join(root,'masked');mkdirSync(output,{mode:0o700});
  if(process.platform!=='win32')chmodSync(output,0o700);
  t.after(()=>{
    try{f.close();}catch{}
    rmSync(root,{recursive:true,force:true,maxRetries:4,retryDelay:50});
  });
  const maskFor=index=>{
    const frame=f.frames[index];
    return {
      parent_evidence_id:f.plan.data.shots[index].capture_evidence_id,
      source_png_path:frame.png_path,source_png_sha256:frame.png_sha256,
      rights:'owned',
      rectangles:[
        {label:'account-area',x:190,y:88,width:64,height:40},
        {label:'profile-area',x:280,y:211,width:50,height:32}
      ],
      acknowledge_source_rights:true,acknowledge_residual_privacy_unknown:true,
      acknowledge_masked_pixels:true
    };
  };
  const confirm=plan=>({
    confirm_plan_sha256:plan.plan_sha256,
    confirm_source_png_sha256:plan.source_png_sha256,
    acknowledge_private_file_write:true
  });
  return{...f,root,output,maskFor,confirm};
}
test('R55 plan proves exact rectangle/pixel counters, but never claims global privacy PASS',async t=>{
  const f=await fixture(t),input=f.maskFor(0);
  const plan=preparePixelMask(f.app,input);
  assert.deepEqual(plan,preparePixelMask(f.app,input));
  assert.deepEqual(verifyPixelMask(f.app,plan,input),plan);
  assert.equal(plan.masked_pixels,64*40+50*32);
  assert.equal(plan.total_pixels,640*360);
  assert.equal(plan.width,640);assert.equal(plan.height,360);
  assert.equal(plan.technical_state,'UNKNOWN');
  assert.equal(plan.pii_outside_masks_verified,false);
  assert.equal(plan.independent_visual_review,false);
  assert.equal(plan.observed_state_eligible,false);
  assert.equal(plan.external_publication,false);
  assert.ok(!JSON.stringify(plan).includes(f.localRoot));
  assert.ok(!JSON.stringify(plan).includes('frame-1.png'));
  assert.equal(f.app.list('evidence',f.b.release.id).length,4,'Planning adds no evidence');
  assert.deepEqual(readdirSync(f.output),[]);
});
test('R55 real source→mask PNG proves all masked pixels opaque and every unmasked pixel unchanged',async t=>{
  const f=await fixture(t),input=f.maskFor(0),plan=preparePixelMask(f.app,input);
  const result=await applyPixelMask(f.app,plan,input,f.output,f.confirm(plan));
  assert.equal(result.files_created,2);
  assert.equal(result.derived_evidence_created,true);
  assert.equal(result.recovered,false);
  assert.equal(result.total_pixels,640*360);
  assert.equal(result.masked_pixels,64*40+50*32);
  assert.equal(result.independent_privacy_review,false);
  assert.equal(result.all_personal_information_removed,false);
  const redacted=readFileSync(join(f.output,result.output_filename));
  assert.equal(sha(redacted),plan.masked_png_sha256);
  assert.equal(redacted[25],2,'Output uses RGB without alpha');
  const original=PNG.sync.read(readFileSync(input.source_png_path),{checkCRC:true});
  const after=PNG.sync.read(redacted,{checkCRC:true});
  const inside=(x,y)=>input.rectangles.some(m=>
    x>=m.x&&x<m.x+m.width&&y>=m.y&&y<m.y+m.height);
  let examined=0,covered=0;
  for(let y=0;y<original.height;y++)for(let x=0;x<original.width;x++){
    const i=(y*original.width+x)*4;
    examined++;
    if(inside(x,y)){
      covered++;assert.deepEqual([...after.data.subarray(i,i+4)],[8,22,33,255]);
    }else assert.deepEqual(after.data.subarray(i,i+4),
      original.data.subarray(i,i+4),'Uncovered source pixel modified');
  }
  assert.equal(examined,plan.total_pixels);
  assert.equal(covered,plan.masked_pixels);
  const saved=JSON.parse(readFileSync(join(f.output,result.receipt_filename),'utf8'));
  assert.equal(saved.original_evidence_id,input.parent_evidence_id);
  assert.equal(saved.source_pixels_outside_mask_unchanged,true);
  assert.equal(saved.technical_state,'UNKNOWN');
  assert.equal(saved.platform_authority,false);
  const native=f.app.get(result.derived_evidence_id,'evidence');
  assert.equal(native.data.classification,'sanitized');
  assert.equal(native.data.provenance.capture_class,'SANITIZED_DERIVATIVE');
  assert.equal(native.data.provenance.parent_evidence_id,input.parent_evidence_id);
  assert.equal(native.data.provenance.transformations[0].semantic_effect,'changes-observed-state');
  assert.equal(native.data.provenance.transformations[0].operation_ref,plan.plan_sha256);
  assert.equal(native.data.technical,'UNKNOWN');
  assert.equal(native.data.observed_state_eligible,false);
  assert.equal(native.data.host_acceptance,'NOT_ESTABLISHED');
});
test('R55 deterministic PNG and Native derivative can recover after lost response or partially missing file',async t=>{
  const f=await fixture(t),input=f.maskFor(0),plan=preparePixelMask(f.app,input);
  const first=await applyPixelMask(f.app,plan,input,f.output,f.confirm(plan));
  await wait(1200);
  const second=await applyPixelMask(f.app,plan,input,f.output,f.confirm(plan));
  assert.equal(second.recovered,true);
  assert.equal(second.files_created,0);
  assert.equal(second.derived_evidence_created,false);
  assert.equal(second.derived_evidence_id,first.derived_evidence_id);
  assert.equal(second.redacted_png_sha256,first.redacted_png_sha256);
  const receipt=join(f.output,first.receipt_filename);rmSync(receipt);
  const third=await applyPixelMask(f.app,plan,input,f.output,f.confirm(plan));
  assert.equal(third.files_created,1);
  assert.equal(third.derived_evidence_created,false);
  assert.equal(f.app.list('evidence',f.b.release.id).length,5);
});
test('R55 rejects tampered source bytes, altered masks, stale revisions, wrong consent and rights before any effects',async t=>{
  const f=await fixture(t),input=f.maskFor(0),plan=preparePixelMask(f.app,input);
  assert.throws(()=>verifyPixelMask(f.app,{...plan,width:200},input),{code:'Conflict'});
  for(const delta of [
    {acknowledge_source_rights:false},
    {acknowledge_residual_privacy_unknown:false},
    {acknowledge_masked_pixels:false},
    {rights:'licensed'}
  ])assert.throws(()=>preparePixelMask(f.app,{...input,...delta}));
  await assert.rejects(applyPixelMask(f.app,plan,input,f.output,{
    ...f.confirm(plan),confirm_plan_sha256:'b'.repeat(64)
  }),{code:'ConsentRequired'});
  await assert.rejects(applyPixelMask(f.app,plan,input,f.output,{
    ...f.confirm(plan),confirm_source_png_sha256:'a'.repeat(64)
  }),{code:'ConsentRequired'});
  assert.deepEqual(readdirSync(f.output),[]);
  // Approving a different scoped source revision makes the original plan stale.
  const updated=await execute(f.app,'entity.update',{
    id:f.source.id,expected:f.source.version,
    data:{...f.source.data,purpose:'Updated owned capture source purpose'}
  });
  assert.ok(updated.entity);
  assert.throws(()=>verifyPixelMask(f.app,plan,input),{code:'StaleReference'});
  assert.deepEqual(readdirSync(f.output),[]);
});
test('R55 mask geometry is fail-closed: negative, zero, overlapping, out-of-range and most-screen masking',async t=>{
  const f=await fixture(t),base=f.maskFor(0);
  for(const rectangles of [
    [{label:'a',x:-1,y:1,width:30,height:20}],
    [{label:'a',x:1,y:1,width:0,height:20}],
    [{label:'a',x:639,y:1,width:2,height:20}],
    [{label:'a',x:1,y:359,width:20,height:2}],
    [{label:'a',x:1,y:1,width:30,height:30},
      {label:'b',x:20,y:20,width:20,height:20}],
    [{label:'a',x:1,y:1,width:30,height:20},
      {label:'a',x:40,y:1,width:20,height:20}],
    [{label:'a',x:0,y:0,width:640,height:360}],
    Array.from({length:25},(_,i)=>({
      label:'mask'+i,x:i*2,y:1,width:1,height:1
    }))
  ])assert.throws(()=>preparePixelMask(f.app,{...base,rectangles}));
  assert.deepEqual(readdirSync(f.output),[]);
});
test('R55 refuses altered private PNG, corrupt CRC, symlinked data and unsupported screenshot alpha',async t=>{
  const f=await fixture(t),input=f.maskFor(0);
  const path=input.source_png_path;
  const corrupted=Buffer.from(readFileSync(path));corrupted[corrupted.length-8]^=1;
  writeFileSync(path,corrupted);
  assert.throws(()=>preparePixelMask(f.app,input),{code:'Conflict'});
  const fresh={...input,source_png_sha256:sha(corrupted)};
  assert.throws(()=>preparePixelMask(f.app,fresh),{code:'InvalidArgument'});
  if(process.platform!=='win32'){
    const link=join(f.root,'source-link.png');
    symlinkSync(path,link);
    assert.throws(()=>preparePixelMask(f.app,{
      ...fresh,source_png_path:link
    }),{code:'PermissionDenied'});
  }
  const rgba=new PNG({width:64,height:64});
  rgba.data.fill(255);
  rgba.data[3]=10;
  const transparent=PNG.sync.write(rgba);
  writeFileSync(path,transparent);
  assert.throws(()=>preparePixelMask(f.app,{
    ...input,source_png_sha256:sha(transparent),
    rectangles:[{label:'a',x:0,y:0,width:10,height:10}]
  }),{code:'InvalidArgument'});
});
test('R55 altered destination and stale lock cannot clobber human files or produce a second Native receipt',async t=>{
  const f=await fixture(t),input=f.maskFor(0),plan=preparePixelMask(f.app,input);
  const first=await applyPixelMask(f.app,plan,input,f.output,f.confirm(plan));
  const file=join(f.output,first.output_filename);
  writeFileSync(file,'human-owned replacement');
  await assert.rejects(applyPixelMask(f.app,plan,input,f.output,f.confirm(plan)),
    {code:'Conflict'});
  assert.equal(readFileSync(file,'utf8'),'human-owned replacement');
  if(process.platform!=='win32'){
    const publicDir=join(f.root,'public-output');mkdirSync(publicDir,{mode:0o755});
    chmodSync(publicDir,0o755);
    await assert.rejects(applyPixelMask(f.app,plan,input,publicDir,f.confirm(plan)),
      {code:'PermissionDenied'});
    const alias=join(f.root,'symlink-output');symlinkSync(f.output,alias);
    await assert.rejects(applyPixelMask(f.app,plan,input,alias,f.confirm(plan)),
      {code:'PermissionDenied'});
  }
  const lock=join(f.app.store.root,'.pixel-mask-apply.lock');
  writeFileSync(lock,'another operator owns lock',{mode:0o600});
  await assert.rejects(applyPixelMask(f.app,plan,input,f.output,f.confirm(plan)),
    {code:'Conflict'});
  assert.equal(readFileSync(lock,'utf8'),'another operator owns lock');
  assert.equal(f.app.list('evidence',f.b.release.id).length,5);
});
test('R55 has no false privacy PASS and cannot mask an imported/rederived source as original observed evidence',async t=>{
  const f=await fixture(t),input=f.maskFor(0);
  const parent=f.app.get(input.parent_evidence_id,'evidence');
  const mask=preparePixelMask(f.app,input);
  const first=await applyPixelMask(f.app,mask,input,f.output,f.confirm(mask));
  assert.equal(first.independent_privacy_review,false);
  assert.equal(first.all_personal_information_removed,false);
  assert.equal(first.platform_authority,false);
  assert.equal(f.app.get(first.derived_evidence_id,'evidence').data.observed_state_eligible,false);
  assert.throws(()=>preparePixelMask(f.app,{...input,
    parent_evidence_id:first.derived_evidence_id
  }),{code:'PermissionDenied'});
  assert.equal(parent.data.observed_state_eligible,true,
    'Canonical parent declaration is not promoted/demoted by a local pixel mask');
});
test('R55 actual Native masked derivatives can replace R43 declared masks in a fresh offline demo without elevating technical truth',async t=>{
  const f=await fixture(t);
  const inputs=[f.maskFor(0),f.maskFor(1)];
  const redacted=[];
  for(const input of inputs){
    const plan=preparePixelMask(f.app,input);
    const created=await applyPixelMask(f.app,plan,input,f.output,f.confirm(plan));
    redacted.push({...created,
      png_path:join(f.output,created.output_filename)});
  }
  const props=[
    'release_id','target_id','scenario_id','name','backend','frame_rate',
    'duration','shots','assets','tracks','variants','interactive_policy'
  ];
  const sourcePlan=Object.fromEntries(props.map(k=>[k,f.plan.data[k]]));
  sourcePlan.shots=sourcePlan.shots.map((s,i)=>({
    ...s,interactive_evidence_id:redacted[i].derived_evidence_id,
    transform_refs:['r55-exact-pixel-mask']
  }));
  const revised=(await execute(f.app,'media.revise',{
    id:f.plan.id,expected:f.plan.version,plan:sourcePlan,
    reason:'Exact measured pixel mask derivative for each owned state'
  })).entity;
  const demoFrames=f.frames.map((item,i)=>({
    ...item,source_evidence_id:redacted[i].derived_evidence_id,
    png_path:redacted[i].png_path,
    png_sha256:redacted[i].redacted_png_sha256
  }));
  const demoInput={...f.input,media_plan_id:revised.id,frames:demoFrames};
  const demoPlan=planInteractiveDemo(f.app,demoInput);
  const demo=await exportInteractiveDemo(f.app,demoPlan,demoInput,f.output,{
    confirm_plan_sha256:demoPlan.plan_sha256,
    confirm_media_plan_digest:demoPlan.media_plan_digest,
    acknowledge_private_export:true
  });
  assert.equal(demo.technical_state,'UNKNOWN');
  assert.equal(demo.pixel_privacy_independently_verified,false);
  const zipped=await JSZip.loadAsync(readFileSync(join(f.output,demo.filename)),{checkCRC32:true});
  const html=await zipped.file('index.html').async('string');
  assert.ok(!/<script\b|https?:\/\//iu.test(html));
  const manifest=JSON.parse(await zipped.file('manifest.json').async('string'));
  assert.deepEqual(manifest.screenshots.map(x=>x.source_evidence_id),
    redacted.map(x=>x.derived_evidence_id));
  assert.equal(manifest.technical_state,'UNKNOWN');
  assert.equal(manifest.pixel_privacy_independently_verified,false);
  for(const native of redacted){
    const record=f.app.get(native.derived_evidence_id,'evidence');
    assert.equal(record.data.technical,'UNKNOWN');
    assert.equal(record.data.provenance.capture_class,'SANITIZED_DERIVATIVE');
  }
});


test('R55 real PNG ancillary metadata is removed without changing unmasked pixel values',async t=>{
  const f=await fixture(t),input=f.maskFor(0);
  const raw=readFileSync(input.source_png_path);
  const payload=Buffer.from('OperatorPrivateNote'+String.fromCharCode(0)+'synthetic metadata never copied');
  const tag=Buffer.from('tEXt');
  const chunk=Buffer.alloc(12+payload.length);
  chunk.writeUInt32BE(payload.length,0);
  tag.copy(chunk,4);payload.copy(chunk,8);
  let crc=0xffffffff;
  for(const byte of Buffer.concat([tag,payload])){
    crc^=byte;
    for(let n=0;n<8;n++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);
  }
  chunk.writeUInt32BE((crc^0xffffffff)>>>0,8+payload.length);
  const annotated=Buffer.concat([raw.subarray(0,33),chunk,raw.subarray(33)]);
  writeFileSync(input.source_png_path,annotated);
  const bound={...input,source_png_sha256:sha(annotated)};
  const plan=preparePixelMask(f.app,bound);
  const result=await applyPixelMask(f.app,plan,bound,f.output,f.confirm(plan));
  const output=readFileSync(join(f.output,result.output_filename));
  assert.equal(output.includes(Buffer.from('OperatorPrivateNote')),false);
  assert.equal(output.includes(Buffer.from('synthetic metadata never copied')),false);
  assert.equal(output.includes(Buffer.from('tEXt')),false);
  assert.equal(PNG.sync.read(output,{checkCRC:true}).width,640);
  assert.equal(result.metadata_chunks_removed,true);
  assert.equal(result.technical_state,'UNKNOWN');
});
test('R55 CLI private two-phase plan and Native apply require exact operator SHA confirmations',async t=>{
  const f=await fixture(t),input=f.maskFor(0);
  const request=join(f.root,'operator-mask.json'),
    file=join(f.root,'saved-mask-plan.json');
  writeFileSync(request,JSON.stringify(input),{mode:0o600,flag:'wx'});
  const run=args=>spawnSync(process.execPath,['scripts/pixel-mask.mjs',...args],{
    cwd:workingRoot,encoding:'utf8',timeout:16000
  });
  const planArgs=['plan','--state',f.app.store.root,
    '--input',request,'--out',file];
  const prepared=run(planArgs);
  assert.equal(prepared.status,0,prepared.stdout+prepared.stderr);
  assert.equal(JSON.parse(prepared.stdout).native_mutations_performed,false);
  const plan=JSON.parse(readFileSync(file,'utf8'));
  assert.equal(plan.plan_sha256,preparePixelMask(f.app,input).plan_sha256);
  if(process.platform!=='win32'){
    const {statSync}=await import('node:fs');
    assert.equal(statSync(file).mode&0o077,0);
  }
  assert.notEqual(run(planArgs).status,0,'A private plan cannot be overwritten');
  const applyArgs=['apply','--state',f.app.store.root,'--input',request,
    '--plan',file,'--output-dir',f.output,
    '--confirm-plan',plan.plan_sha256,
    '--confirm-source',plan.source_png_sha256,'--acknowledge-private-write'];
  const missing=run(applyArgs.slice(0,-1));
  assert.notEqual(missing.status,0);
  assert.equal(f.app.list('evidence',f.b.release.id).length,4);
  const applied=run(applyArgs);
  assert.equal(applied.status,0,applied.stdout+applied.stderr);
  assert.equal(JSON.parse(applied.stdout).derived_evidence_created,true);
  const repeated=run(applyArgs);
  assert.equal(repeated.status,0,repeated.stdout+repeated.stderr);
  const result=JSON.parse(repeated.stdout);
  assert.equal(result.recovered,true);
  assert.equal(result.derived_evidence_created,false);
  assert.equal(result.files_created,0);
  assert.equal(f.app.list('evidence',f.b.release.id).length,5);
});
