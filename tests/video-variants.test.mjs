// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,chmodSync,rmSync,statSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import JSZip from 'jszip';
import {execute} from '../src/application.mjs';
import {ownedVideoFixture,FFMPEG_AVAILABLE} from './video-variants-fixture.mjs';
import {
 planVideoVariants,verifyVideoPlan,exportVideoVariants,
 validateNativeWebVtt,probeLocalMp4
} from '../src/video-variants.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const worktree=fileURLToPath(new URL('../',import.meta.url));
const real=(name,fn)=>test(name,{skip:!FFMPEG_AVAILABLE},fn);
real('R46 no-effects plan binds exact Native Media MP4, human approval and immutable WebVTT',async t=>{
  const f=await ownedVideoFixture(t);
  const p=planVideoVariants(f.app,f.input),second=planVideoVariants(f.app,f.input);
  assert.deepEqual(p,second);
  assert.deepEqual(verifyVideoPlan(f.app,p,f.input),p);
  assert.equal(p.landscape_dimensions,'1280x720');
  assert.equal(p.vertical_dimensions,'720x1280');
  assert.equal(p.captions_cues,2);
  assert.equal(p.source_technical_state,'UNKNOWN');
  assert.equal(p.derivative_technical_state,'UNKNOWN');
  assert.equal(p.platform_authority,false);
  assert.equal(p.publication_authority,false);
  assert.equal(f.app.list('media_output').length,1);
  assert.deepEqual(readdirSync(f.outDir),[]);
  assert.ok(!JSON.stringify(p).includes(f.root),'No raw private path in saved plan');
  assert.match(p.plan_sha256,/^[a-f0-9]{64}$/);
});

real('R46 real MP4 variants keep full landscape pixels within 720x1280, source AAC and exact frozen VTT',async t=>{
  const f=await ownedVideoFixture(t),p=planVideoVariants(f.app,f.input);
  const r=await exportVideoVariants(f.app,p,f.input,f.outDir,f.approve(p));
  assert.equal(r.files_created,2);
  assert.equal(r.media_output_created,true);
  assert.equal(r.published,false);
  assert.equal(r.source_timeline_recomposed,false);
  assert.equal(r.alternate_voice_generated,false);
  assert.equal(r.local_technical_state,'UNKNOWN');
  const archive=readFileSync(join(f.outDir,r.zip_filename));
  assert.equal(hash(archive),r.zip_sha256);
  const zip=await JSZip.loadAsync(archive,{checkCRC32:true});
  assert.deepEqual(Object.keys(zip.files).sort(),[
    'README.txt','captions.vtt','landscape-16x9.mp4','manifest.json','portrait-9x16.mp4'
  ]);
  const m=JSON.parse(await zip.file('manifest.json').async('string'));
  assert.equal(m.plan_sha256,p.plan_sha256);
  assert.equal(m.sources.native_vtt_sha256,p.captions_sha256);
  assert.equal(m.outputs['landscape-16x9.mp4'].sha256,f.videoSha);
  assert.equal(m.outputs['portrait-9x16.mp4'].sha256,r.portrait_mp4_sha256);
  assert.equal(m.outputs['portrait-9x16.mp4'].dimensions,'720x1280');
  assert.equal(m.cropping_performed,false);
  assert.equal(m.captions_burned_in,false);
  assert.equal(m.alternate_voice_generated,false);
  assert.equal(m.public_release_performed,false);
  assert.equal(m.semwright_platform_authority,false);
  const original=await zip.file('landscape-16x9.mp4').async('nodebuffer');
  assert.equal(hash(original),f.videoSha);
  const originalVTT=f.app.store.readBlob(f.vtt.data.sha256).bytes;
  assert.deepEqual(await zip.file('captions.vtt').async('nodebuffer'),originalVTT);
  const media=f.app.get(r.media_output_id,'media_output');
  assert.equal(media.data.authority,'imported');
  assert.equal(media.data.technical_effective,'UNKNOWN');
  assert.equal(media.data.variant_id,'portrait');
  assert.equal(media.data.artifact_sha256,r.portrait_mp4_sha256);
});

real('R46 derived video bytes and ZIP remain identical across timestamp changes and exact resume',async t=>{
  const f=await ownedVideoFixture(t),p=planVideoVariants(f.app,f.input);
  const first=await exportVideoVariants(f.app,p,f.input,f.outDir,f.approve(p));
  await new Promise(resolve=>setTimeout(resolve,1200));
  const again=await exportVideoVariants(f.app,p,f.input,f.outDir,f.approve(p));
  assert.equal(again.zip_sha256,first.zip_sha256);
  assert.equal(again.portrait_mp4_sha256,first.portrait_mp4_sha256);
  assert.equal(again.recovered,true);
  assert.equal(again.files_created,0);
  assert.equal(again.media_output_id,first.media_output_id);
  const receiptName='launchwright-video-'+p.plan_sha256.slice(0,12)+'.receipt.json';
  rmSync(join(f.outDir,receiptName));
  const partial=await exportVideoVariants(f.app,p,f.input,f.outDir,f.approve(p));
  assert.equal(partial.files_created,1);
  assert.equal(partial.media_output_created,false);
  assert.equal(partial.zip_sha256,first.zip_sha256);
  assert.equal(f.app.list('media_output').length,2);
});

real('R46 unreviewed source, changed candidate and rejected consent never mutate artifacts',async t=>{
  const f=await ownedVideoFixture(t,{addReview:false});
  assert.throws(()=>planVideoVariants(f.app,f.input),{code:'ConsentRequired'});
  await execute(f.app,'media.review_record',{output_id:f.master.id,artifact_sha256:f.videoSha,
    decision:'approve-editorial',comment:'Owned late editorial review'});
  const p=planVideoVariants(f.app,f.input);
  assert.throws(()=>planVideoVariants(f.app,{...f.input,acknowledge_audio_rights:false}),
    {code:'ConsentRequired'});
  assert.throws(()=>planVideoVariants(f.app,{...f.input,acknowledge_technical_unknown:false}),
    {code:'ConsentRequired'});
  await assert.rejects(exportVideoVariants(f.app,p,f.input,f.outDir,{
    ...f.approve(p),confirm_plan_sha256:'a'.repeat(64)
  }),{code:'ConsentRequired'});
  assert.throws(()=>verifyVideoPlan(f.app,{...p,frames:900},f.input),{code:'Conflict'});
  assert.deepEqual(readdirSync(f.outDir),[]);
});

real('R46 malicious or edited MP4, unapproved rights and audio mismatch are rejected before any reencode',async t=>{
  const f=await ownedVideoFixture(t),p=planVideoVariants(f.app,f.input);
  assert.throws(()=>planVideoVariants(f.app,{...f.input,source_mp4_sha256:'a'.repeat(64)}),
    {code:'Conflict'});
  writeFileSync(f.file,'edited original owned sample');
  assert.throws(()=>planVideoVariants(f.app,f.input),{code:'Conflict'});
  await assert.rejects(exportVideoVariants(f.app,p,f.input,f.outDir,f.approve(p)),
    {code:'Conflict'});
  assert.deepEqual(readdirSync(f.outDir),[]);
});

real('R46 current Media source invalidation is not fixed by re-signing operator flags',async t=>{
  const f=await ownedVideoFixture(t),p=planVideoVariants(f.app,f.input);
  await execute(f.app,'entity.update',{id:f.source.id,expected:f.source.version,
    data:{...f.source.data,purpose:'Changed media source approval scope'}});
  assert.throws(()=>planVideoVariants(f.app,f.input),{code:'StaleReference'});
  await assert.rejects(exportVideoVariants(f.app,p,f.input,f.outDir,f.approve(p)),
    {code:'StaleReference'});
  assert.deepEqual(readdirSync(f.outDir),[]);
});

real('R46 preexisting modified ZIP is protected and explicit operator stale lock blocks concurrent export',async t=>{
  const f=await ownedVideoFixture(t),p=planVideoVariants(f.app,f.input);
  const lock=join(f.app.store.root,'.video-variants-apply.lock');
  writeFileSync(lock,'Another user owns import',{mode:0o600});
  await assert.rejects(exportVideoVariants(f.app,p,f.input,f.outDir,f.approve(p)),
    {code:'Conflict'});
  assert.equal(readFileSync(lock,'utf8'),'Another user owns import');
  rmSync(lock);
  const first=await exportVideoVariants(f.app,p,f.input,f.outDir,f.approve(p));
  const target=join(f.outDir,first.zip_filename);
  writeFileSync(target,'Human changed archive');
  await assert.rejects(exportVideoVariants(f.app,p,f.input,f.outDir,f.approve(p)),
    {code:'Conflict'});
  assert.equal(readFileSync(target,'utf8'),'Human changed archive');
});

real('R46 conflicting preexisting Native vertical output fails closed before local file writes',async t=>{
  const f=await ownedVideoFixture(t),p=planVideoVariants(f.app,f.input);
  await execute(f.app,'media.output_record',{
    plan_id:f.plan.id,variant_id:'portrait',state:'SUCCEEDED',
    authority:'imported',provider:'unrelated',provider_version:'r0',
    artifact_sha256:'b'.repeat(64),mime:'video/mp4',
    duration:{num:'4',den:'1'},observed_at:'2026-10-09T20:00:00.000Z',
    reported_verification:'UNKNOWN'
  });
  await assert.rejects(exportVideoVariants(f.app,p,f.input,f.outDir,f.approve(p)),
    {code:'Conflict'});
  assert.deepEqual(readdirSync(f.outDir),[]);
});

test('R46 caption parser refuses overlapping/out-of-bounds/improper UTF-8 and retains millisecond timing',()=>{
  const good=Buffer.from('WEBVTT\n\n1\n00:00:00.500 --> 00:00:01.300\nHello\n\n2\n00:00:01.500 --> 00:00:02.200\nNext\n\n');
  assert.deepEqual(validateNativeWebVtt(good,4000).map(x=>[x.start_ms,x.end_ms]),
    [[500,1300],[1500,2200]]);
  for(const s of [
    'WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\nHello\n\n2\n00:00:01.500 --> 00:00:03.000\nOverlap\n',
    'WEBVTT\n\n1\n00:00:03.500 --> 00:00:04.100\nToo late\n',
    'WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\n<script>unsafe</script>\n',
    'WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\nFoo\nBar\n',
    'NOT-VTT\n\n1\n00:00:01.000 --> 00:00:02.000\nOops\n'
  ])assert.throws(()=>validateNativeWebVtt(Buffer.from(s),4000));
});

test('R46 video probe with untrusted input refuses scripts and nonexistent ffmpeg paths',()=>{
  assert.throws(()=>probeLocalMp4('/no/such/private/source.mp4'));
});


real('R46 audio stream decoded PCM is exactly preserved across landscape and portrait',async t=>{
  const f=await ownedVideoFixture(t),p=planVideoVariants(f.app,f.input);
  const r=await exportVideoVariants(f.app,p,f.input,f.outDir,f.approve(p));
  const zip=await JSZip.loadAsync(readFileSync(join(f.outDir,r.zip_filename)));
  const portraitPath=join(f.root,'for-audio-inspection.mp4');
  writeFileSync(portraitPath,await zip.file('portrait-9x16.mp4').async('nodebuffer'),{mode:0o600});
  const pcm=file=>{
    const result=spawnSync('ffmpeg',[
      '-hide_banner','-nostdin','-v','error',
      '-protocol_whitelist','file,pipe','-i',file,
      '-map','0:a:0','-vn','-f','s16le','-ac','2','-ar','48000','-'
    ],{timeout:15000,maxBuffer:4*1024*1024});
    assert.equal(result.status,0,result.stderr?.toString());
    return result.stdout;
  };
  const master=pcm(f.file),derived=pcm(portraitPath);
  assert.ok(master.length>100000);
  assert.equal(hash(master),hash(derived),
    'Operator approved source AAC must decode to identical samples after aspect conversion');
});

real('R46 CLI plan writes exclusive private intent and explicitly confirmed export recovers same Native Media output',async t=>{
  const f=await ownedVideoFixture(t);
  const inputPath=join(f.root,'private-source-input.json'),
    planPath=join(f.root,'private-video-plan.json');
  writeFileSync(inputPath,JSON.stringify(f.input),{mode:0o600});
  const call=args=>spawnSync(process.execPath,['scripts/video-variants.mjs',...args],
    {cwd:worktree,encoding:'utf8',timeout:20000});
  const prepare=['plan','--state',f.root,'--input',inputPath,'--out',planPath];
  const initial=call(prepare);
  assert.equal(initial.status,0,initial.stdout+initial.stderr);
  const saved=JSON.parse(readFileSync(planPath,'utf8'));
  assert.equal(JSON.parse(initial.stdout).workspace_mutated,false);
  assert.notEqual(call(prepare).status,0,'Saved private plans must never be overwritten');
  if(process.platform!=='win32'){
    assert.equal(statSync(planPath).mode&0o077,0);
  }
  const apply=['export','--state',f.root,'--input',inputPath,
    '--plan-file',planPath,'--out-dir',f.outDir,
    '--confirm-plan',saved.plan_sha256,
    '--confirm-source',saved.source_mp4_sha256,'--acknowledge-private-export'];
  const first=call(apply);
  assert.equal(first.status,0,first.stdout+first.stderr);
  const accepted=JSON.parse(first.stdout);
  assert.equal(accepted.files_created,2);
  assert.equal(accepted.technical_state,'UNKNOWN');
  const second=call(apply);
  assert.equal(second.status,0,second.stdout+second.stderr);
  const same=JSON.parse(second.stdout);
  assert.equal(same.zip_sha256,accepted.zip_sha256);
  assert.equal(same.media_output_id,accepted.media_output_id);
  assert.equal(same.recovered,true);
});


real('R46 a known FAILED technical Media source cannot be promoted by operator consent',async t=>{
  const f=await ownedVideoFixture(t);
  const failed=(await execute(f.app,'media.output_record',{
    plan_id:f.plan.id,variant_id:'landscape',state:'SUCCEEDED',
    authority:'imported',provider:'owned-failure-fixture',provider_version:'1',
    artifact_sha256:f.videoSha,mime:'video/mp4',
    duration:{num:'4',den:'1'},observed_at:'2026-10-09T20:00:00.000Z',
    reported_verification:'FAIL'
  })).entity;
  assert.equal(failed.data.technical_effective,'FAIL');
  assert.throws(()=>planVideoVariants(f.app,{
    ...f.input,media_output_id:failed.id
  }),{code:'PermissionDenied'});
  assert.deepEqual(readdirSync(f.outDir),[]);
});

real('R46 ffprobe rejects a source MP4 with missing AAC audio even if H264 frames decode',async t=>{
  const f=await ownedVideoFixture(t);
  const silent=join(f.root,'video-with-no-audio.mp4');
  const r=spawnSync('ffmpeg',[
    '-hide_banner','-v','error','-nostdin','-i',f.file,
    '-map','0:v:0','-c:v','copy','-an','-y',silent
  ],{timeout:12000,encoding:'utf8'});
  assert.equal(r.status,0,r.stderr);
  assert.throws(()=>probeLocalMp4(silent),{code:'InvalidArgument'});
});


real('R46 a later changes-requested editorial decision supersedes earlier source video approval',async t=>{
  const f=await ownedVideoFixture(t);
  const before=planVideoVariants(f.app,f.input);
  assert.equal(before.source_output_id,f.master.id);
  await execute(f.app,'media.review_record',{
    output_id:f.master.id,artifact_sha256:f.videoSha,
    decision:'changes-requested',comment:'Independent reviewer rejects current synthetic footage'
  });
  assert.throws(()=>planVideoVariants(f.app,f.input),{code:'ConsentRequired'});
  await assert.rejects(exportVideoVariants(f.app,before,f.input,f.outDir,f.approve(before)),
    {code:'ConsentRequired'});
  assert.deepEqual(readdirSync(f.outDir),[]);
});

real('R46 a newer master Media output invalidates an older approved MP4 identity',async t=>{
  const f=await ownedVideoFixture(t);
  const original=planVideoVariants(f.app,f.input);
  await execute(f.app,'media.output_record',{
    plan_id:f.plan.id,variant_id:'landscape',state:'SUCCEEDED',
    authority:'imported',provider:'new-unreviewed-source',provider_version:'2',
    artifact_sha256:'b'.repeat(64),mime:'video/mp4',
    duration:{num:'4',den:'1'},observed_at:'2026-10-09T20:00:00.000Z',
    reported_verification:'UNKNOWN'
  });
  assert.throws(()=>planVideoVariants(f.app,f.input),{code:'StaleReference'});
  await assert.rejects(exportVideoVariants(f.app,original,f.input,f.outDir,f.approve(original)),
    {code:'StaleReference'});
});
