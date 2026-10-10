// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import JSZip from 'jszip';
import { ownedVideoFixture } from './video-variants-fixture.mjs';
import { planVideoVariants, exportVideoVariants } from '../src/video-variants.mjs';
import {
  strictBurninCues, planVideoCaptionBurnin,verifyVideoCaptionBurnin,
  exportVideoCaptionBurnin
} from '../src/video-caption-burnin.mjs';

const hash=buffer=>createHash('sha256').update(buffer).digest('hex');
const vtt=(body='Owned synthetic source state',end='00:00:01.200')=>
  Buffer.from('WEBVTT\n\n1\n00:00:00.500 --> '+end+'\n'+body+'\n');
const real=process.env.LAUNCHWRIGHT_VIDEO_BURNIN_REAL_TESTS==='1'&&
  process.platform==='linux';
function decodeAudio(path){
  const r=spawnSync('ffmpeg',[
    '-hide_banner','-nostdin','-v','error',
    '-protocol_whitelist','file,pipe','-i',path,
    '-map','0:a:0','-vn','-ac','2','-ar','48000',
    '-f','s16le','pipe:1'
  ],{timeout:15000,maxBuffer:16*1024*1024});
  assert.equal(r.status,0,r.stderr?.toString());
  return r.stdout;
}
function videoFrame(path,time,width,height){
  const r=spawnSync('ffmpeg',[
    '-hide_banner','-nostdin','-v','error',
    '-protocol_whitelist','file,pipe','-i',path,
    '-ss',String(time),'-map','0:v:0',
    '-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1'
  ],{timeout:20000,maxBuffer:12*1024*1024});
  assert.equal(r.status,0,r.stderr?.toString());
  assert.equal(r.stdout.length,width*height*3);
  return r.stdout;
}
function strongPixelChanges(before,after,width,height,startY,endY){
  let changed=0;
  for(let y=startY;y<Math.min(height,endY);y++)
    for(let x=0;x<width;x++){
      const offset=(y*width+x)*3;
      const delta=Math.abs(before[offset]-after[offset])+
        Math.abs(before[offset+1]-after[offset+1])+
        Math.abs(before[offset+2]-after[offset+2]);
      if(delta>=140)changed++;
    }
  return changed;
}
function bottomChanged(before,after,width,height){
  return strongPixelChanges(before,after,width,height,
    Math.floor(height*.60),height);
}
function cli(args){
  return spawnSync(process.execPath,['scripts/video-caption-burnin.mjs',...args],
    {encoding:'utf8',timeout:150000,maxBuffer:500000});
}
test('R62 requires strict bounded native VTT, Latin ASCII text and no ASS styling injection',()=>{
  const cues=strictBurninCues(vtt(),4000);
  assert.deepEqual(cues,[{start_ms:500,end_ms:1200,
    text:'Owned synthetic source state'}]);
  for(const unsafe of ['Emoji 😀','{\\an8} moved','Wrong \\ path',
    'a'.repeat(86),'']){
    assert.throws(()=>strictBurninCues(vtt(unsafe),4000));
  }
  assert.throws(()=>strictBurninCues(vtt('Too short','00:00:00.550'),4000),
    {code:'InvalidArgument'});
  assert.throws(()=>strictBurninCues(vtt('Beyond','00:00:09.000'),4000));
  assert.throws(()=>strictBurninCues(Buffer.from('WEBVTT\n\n1\nnot-a-time\nText\n'),4000));
});
test('R62 rejects overlapping, unbounded and unsafe source captions without FFmpeg effects',()=>{
  const overlapping=Buffer.from(
    'WEBVTT\n\n1\n00:00:00.500 --> 00:00:01.200\nFirst cue\n\n'+
    '2\n00:00:01.100 --> 00:00:02.100\nSecond cue\n');
  assert.throws(()=>strictBurninCues(overlapping,4000));
  const many=Buffer.from('WEBVTT\n\n'+Array.from({length:21},(_,i)=>{
    const start=(i*500).toString().padStart(6,'0');
    const end=(i*500+450).toString().padStart(6,'0');
    const timestamp=ms=>'00:00:'+Math.floor(Number(ms)/1000).toString().padStart(2,'0')+
      '.'+(Number(ms)%1000).toString().padStart(3,'0');
    return (i+1)+'\n'+timestamp(start)+' --> '+timestamp(end)+'\nOwned cue '+i+'\n';
  }).join('\n'));
  assert.throws(()=>strictBurninCues(many,12000),{code:'ResourceExhausted'});
});
test('R62 real frozen Native Media R46 -> two actual captioned MP4s with original AAC and visible glyph changes', {
  skip:!real
},async t=>{
  const f=await ownedVideoFixture(t);
  t.after(()=>{try{f.app.close();}catch{}});
  const base=planVideoVariants(f.app,f.input);
  const parent=await exportVideoVariants(f.app,base,f.input,f.outDir,f.approve(base));
  assert.equal(parent.technical_state,'UNKNOWN');
  const opts={
    r46_plan:base,r46_input:f.input,r46_dir:f.outDir,
    acknowledge_caption_review:true,
    acknowledge_video_privacy_unknown:true,acknowledge_private_only:true
  };
  const prepared=await planVideoCaptionBurnin(f.app,opts);
  assert.deepEqual(await planVideoCaptionBurnin(f.app,opts),prepared);
  assert.deepEqual(await verifyVideoCaptionBurnin(f.app,prepared,opts),prepared);
  assert.equal(prepared.r46_zip_sha256,parent.zip_sha256);
  assert.equal(prepared.technical_state,'UNKNOWN');
  assert.equal(prepared.cue_count,2);
  assert.equal(prepared.burned_captions_actual,true);
  const out=join(f.root,'r62-private');
  mkdirSync(out,{mode:0o700});
  const inputFile=join(f.root,'r46-input.json'),
    plan46File=join(f.root,'r46-plan.json'),
    plan62File=join(f.root,'r62-plan.json');
  writeFileSync(inputFile,JSON.stringify(f.input),{mode:0o600});
  writeFileSync(plan46File,JSON.stringify(base),{mode:0o600});
  const selection=[
    '--state',f.root,'--r46-plan',plan46File,
    '--r46-input',inputFile,'--r46-dir',f.outDir
  ];
  const planned=cli(['plan',...selection,'--out',plan62File,
    '--acknowledge-caption-review','--acknowledge-privacy-unknown',
    '--acknowledge-private-only']);
  assert.equal(planned.status,0,planned.stdout+planned.stderr);
  const saved=JSON.parse(readFileSync(plan62File,'utf8'));
  assert.deepEqual(saved,prepared);
  const attempted=cli(['export',...selection,'--burnin-plan',plan62File,
    '--out-dir',out,'--confirm-plan','0'.repeat(64),
    '--confirm-r46',prepared.r46_zip_sha256,'--acknowledge-export']);
  assert.notEqual(attempted.status,0);
  const originalCount=f.app.list('media_output').length;
  const applied=cli(['export',...selection,'--burnin-plan',plan62File,
    '--out-dir',out,'--confirm-plan',prepared.plan_sha256,
    '--confirm-r46',prepared.r46_zip_sha256,'--acknowledge-export']);
  assert.equal(applied.status,0,applied.stdout+applied.stderr);
  const result=JSON.parse(applied.stdout);
  assert.equal(result.files_created,2);
  assert.equal(result.new_native_media_receipt_created,false);
  assert.equal(result.technical_state,'UNKNOWN');
  assert.equal(result.published,false);
  assert.equal(f.app.list('media_output').length,originalCount);
  const bundle=readFileSync(join(out,result.zip_filename));
  assert.equal(hash(bundle),result.bundle_sha256);
  const zip=await JSZip.loadAsync(bundle,{checkCRC32:true});
  assert.deepEqual(Object.keys(zip.files).sort(),[
    'README.txt','captions.vtt','landscape-captioned.mp4','manifest.json','portrait-captioned.mp4'
  ]);
  const manifest=JSON.parse(await zip.file('manifest.json').async('string'));
  assert.equal(manifest.source_r46_zip_sha256,parent.zip_sha256);
  assert.equal(manifest.native_source_output_id,base.source_output_id);
  assert.equal(manifest.voice_changed,false);
  assert.equal(manifest.technical_state,'UNKNOWN');
  assert.equal(manifest.captions_burned_in,true);
  const parentZip=await JSZip.loadAsync(
    readFileSync(join(f.outDir,parent.zip_filename)),{checkCRC32:true});
  const tmp=join(f.root,'r62-check-media');
  mkdirSync(tmp,{mode:0o700});
  for(const [format,originalName,burnedName,width,height] of [
    ['landscape','landscape-16x9.mp4','landscape-captioned.mp4',1280,720],
    ['portrait','portrait-9x16.mp4','portrait-captioned.mp4',720,1280]
  ]){
    const oldBytes=await parentZip.file(originalName).async('nodebuffer');
    const newBytes=await zip.file(burnedName).async('nodebuffer');
    const oldPath=join(tmp,format+'-old.mp4'),
      newPath=join(tmp,format+'-captioned.mp4');
    writeFileSync(oldPath,oldBytes,{mode:0o600});
    writeFileSync(newPath,newBytes,{mode:0o600});
    assert.equal(hash(newBytes),manifest.outputs[burnedName].sha256);
    assert.equal(manifest.outputs[burnedName].probe.width,width);
    assert.equal(manifest.outputs[burnedName].probe.height,height);
    assert.equal(manifest.outputs[burnedName].probe.frames,120);
    const audioA=decodeAudio(oldPath),audioB=decodeAudio(newPath);
    assert.equal(hash(audioA),hash(audioB),
      'Approved source AAC must decode identically after burn-in');
    const before=bottomChanged(videoFrame(oldPath,.2,width,height),
      videoFrame(newPath,.2,width,height),width,height);
    const cueSource=videoFrame(oldPath,.8,width,height);
    const cueOverlay=videoFrame(newPath,.8,width,height);
    const withText=bottomChanged(cueSource,cueOverlay,width,height);
    assert.ok(withText>before+200,
      'Caption window had no independently observable burned pixels: '+
      JSON.stringify({format,before,withText}));
    if(format==='portrait'){
      const lowerLetterbox=strongPixelChanges(cueSource,cueOverlay,width,height,
        Math.floor(height*.70),Math.floor(height*.95));
      const productRegion=strongPixelChanges(cueSource,cueOverlay,width,height,
        Math.floor(height*.35),Math.floor(height*.66));
      assert.ok(lowerLetterbox>600,
        'Portrait subtitle was missing from the black lower letterbox');
      assert.ok(productRegion<300,
        'Portrait subtitle overlapped/corrupted the central original UI surface');
    }
  }
  const again=await exportVideoCaptionBurnin(f.app,prepared,opts,out,{
    confirm_plan_sha256:prepared.plan_sha256,
    confirm_r46_zip_sha256:prepared.r46_zip_sha256,
    acknowledge_private_export:true
  });
  assert.equal(again.recovered,true);
  assert.equal(again.files_created,0);
  assert.equal(again.bundle_sha256,result.bundle_sha256);
  assert.equal(f.app.list('media_output').length,originalCount);
  const sourceZipPath=join(f.outDir,parent.zip_filename);
  const originalZipBytes=readFileSync(sourceZipPath);
  writeFileSync(sourceZipPath,Buffer.concat([originalZipBytes,Buffer.from('changed')]));
  await assert.rejects(planVideoCaptionBurnin(f.app,opts),{code:'Conflict'});
  writeFileSync(sourceZipPath,originalZipBytes);
  await assert.rejects(exportVideoCaptionBurnin(f.app,
    {...prepared,ffmpeg_version:'tampered'},opts,out,{
      confirm_plan_sha256:prepared.plan_sha256,
      confirm_r46_zip_sha256:prepared.r46_zip_sha256,
      acknowledge_private_export:true
    }),{code:'Conflict'});
});
