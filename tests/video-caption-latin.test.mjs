// SPDX-License-Identifier: AGPL-3.0-only
// R63 real owned Native Media / WebVTT -> bounded NFC Latin captions.
// No real customer footage, caption translation, new platform/verifier authority.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync,readFileSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
import JSZip from 'jszip';
import { ownedVideoFixture } from './video-variants-fixture.mjs';
import { planVideoVariants,exportVideoVariants } from '../src/video-variants.mjs';
import {
  BURNIN_SCHEMA,BURNIN_LATIN_SCHEMA,strictBurninCues,
  planVideoCaptionBurnin,planVideoCaptionBurninLatin,
  verifyVideoCaptionBurnin,exportVideoCaptionBurnin
} from '../src/video-caption-burnin.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const vtt=(text)=>Buffer.from('WEBVTT\n\n1\n00:00:00.500 --> 00:00:01.300\n'+text+'\n');
const real=process.env.LAUNCHWRIGHT_VIDEO_LATIN_REAL_TESTS==='1'&&
  process.platform==='linux';

function runFfmpeg(args,limit=24*1024*1024){
  const result=spawnSync('ffmpeg',[
    '-hide_banner','-nostdin','-loglevel','error','-protocol_whitelist','file,pipe',
    ...args
  ],{timeout:25000,maxBuffer:limit});
  assert.equal(result.status,0,result.stderr?.toString());
  return result.stdout;
}
const pcm=(path)=>runFfmpeg(['-i',path,'-map','0:a:0','-vn',
  '-ac','2','-ar','48000','-f','s16le','pipe:1']);
const frame=(path,time,width,height)=>{
  const bytes=runFfmpeg(['-i',path,'-ss',String(time),'-map','0:v:0',
    '-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],15*1024*1024);
  assert.equal(bytes.length,width*height*3);
  return bytes;
};
function alteredPixels(a,b,width,height,top,bottom){
  let changed=0;
  for(let y=Math.floor(height*top);y<Math.floor(height*bottom);y++)
    for(let x=0;x<width;x++){
      const i=(y*width+x)*3;
      if(Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+
        Math.abs(a[i+2]-b[i+2])>=140)changed++;
    }
  return changed;
}
test('R63 opt-in profile accepts reviewed precomposed Spanish, French, Portuguese and German Latin punctuation',()=>{
  for(const value of [
    '¡Ya está disponible!','Revisión de edición: función útil.',
    'Olá, coração! Ação e paixão.',"Français: déjà créé, bientôt!",
    'Grüße aus München!','L’édition est prête – oui.'
  ]){
    assert.equal(strictBurninCues(vtt(value),4000,'latin')[0].text,value);
  }
  assert.throws(()=>strictBurninCues(vtt('¡Ya está disponible!'),4000),{code:'InvalidArgument'});
});
test('R63 Latin profile fails closed on emoji, CJK, bidi controls, ASS/VTT injection and decomposed accents',()=>{
  for(const unsafe of [
    'Smile 😃 now','汉字 caption','Привет мир',
    'Invisible \u200b separator','RTL \u202e override',
    '{\\an8} moved','evil \\h spacing',
    '<b>HTML</b>','e\u0301dition decomposed',
    'a'.repeat(86),'\uFEFFInjected BOM',
    'caption with\nhidden newline',
    'English and தமிழ்','math ✓ and annotation'
  ]){
    assert.throws(()=>strictBurninCues(vtt(unsafe),4000,'latin'),
      'Unsafe Latin caption accepted: '+JSON.stringify(unsafe));
  }
  assert.throws(()=>strictBurninCues(vtt('¡'),4000,'latin'),{code:'InvalidArgument'});
  assert.throws(()=>strictBurninCues(vtt('¡Ya!'),4000,'unapproved'),{code:'InvalidArgument'});
});
test('R63 strict timing and cue-length/original Native VTT policies remain unchanged',()=>{
  const good='¡Ahora en español!';
  assert.throws(()=>strictBurninCues(Buffer.from('WEBVTT\n\n1\n00:00:00.500 --> 00:00:00.550\n'+good+'\n'),4000,'latin'),
    {code:'InvalidArgument'});
  assert.throws(()=>strictBurninCues(Buffer.from('WEBVTT\n\n1\n00:00:00.500 --> 00:00:09.000\n'+good+'\n'),4000,'latin'));
  assert.equal(strictBurninCues(vtt('Owned original ASCII cue'),4000)[0].text,
    'Owned original ASCII cue');
});
test('R63 actual es-MX Native Media/R46 and approved NFC Latin VTT produces two MP4s with original AAC and visible pixels',{
  skip:!real
},async t=>{
  const f=await ownedVideoFixture(t,{
    locale:'es-MX',
    captionTexts:['¡Ya está disponible!','Revisión de edición: función útil.']
  });
  t.after(()=>{try{f.app.close();}catch{}});
  const r46=planVideoVariants(f.app,f.input);
  const original=await exportVideoVariants(f.app,r46,f.input,f.outDir,f.approve(r46));
  const selection={
    r46_plan:r46,r46_input:f.input,r46_dir:f.outDir,
    acknowledge_caption_review:true,
    acknowledge_video_privacy_unknown:true,
    acknowledge_private_only:true,
    acknowledge_latin_glyph_review:true
  };
  await assert.rejects(planVideoCaptionBurnin(f.app,selection),{code:'InvalidArgument'});
  await assert.rejects(planVideoCaptionBurninLatin(f.app,{
    ...selection,acknowledge_latin_glyph_review:false
  }),{code:'ConsentRequired'});
  const plan=await planVideoCaptionBurninLatin(f.app,selection);
  assert.equal(plan.schema_version,BURNIN_LATIN_SCHEMA);
  assert.notEqual(plan.schema_version,BURNIN_SCHEMA);
  assert.equal(plan.caption_locale,'es-MX');
  assert.equal(plan.charset_policy,'approved-nfc-latin/1');
  assert.equal(plan.all_caption_glyphs_present_in_font,true);
  assert.match(plan.system_font_sha256,/^[a-f0-9]{64}$/u);
  assert.equal(plan.original_audio_preserved,true);
  assert.equal(plan.technical_state,'UNKNOWN');
  assert.deepEqual(await verifyVideoCaptionBurnin(f.app,plan,selection),plan);
  const mismatch={...plan,system_font_sha256:'f'.repeat(64)};
  await assert.rejects(verifyVideoCaptionBurnin(f.app,mismatch,selection),{code:'Conflict'});
  const out=join(f.root,'r63-private');
  mkdirSync(out,{mode:0o700});
  const inputFile=join(f.root,'r46-latin-input.json'),
    plan46File=join(f.root,'r46-latin-plan.json'),
    plan63File=join(f.root,'r63-latin-plan.json');
  writeFileSync(inputFile,JSON.stringify(f.input),{mode:0o600});
  writeFileSync(plan46File,JSON.stringify(r46),{mode:0o600});
  const cmd=(args)=>spawnSync(process.execPath,[
    'scripts/video-caption-burnin.mjs',...args
  ],{encoding:'utf8',timeout:20000});
  const sourceArgs=['--state',f.root,'--r46-plan',plan46File,
    '--r46-input',inputFile,'--r46-dir',f.outDir];
  const cliDenied=cmd(['plan',...sourceArgs,'--out',plan63File,
    '--latin-nfc','--acknowledge-caption-review',
    '--acknowledge-privacy-unknown','--acknowledge-private-only']);
  assert.notEqual(cliDenied.status,0);
  const planned=cmd(['plan',...sourceArgs,'--out',plan63File,
    '--latin-nfc','--acknowledge-caption-review','--acknowledge-latin-glyph-review',
    '--acknowledge-privacy-unknown','--acknowledge-private-only']);
  assert.equal(planned.status,0,planned.stdout+planned.stderr);
  assert.deepEqual(JSON.parse(readFileSync(plan63File,'utf8')),plan);
  const before=f.app.list('media_output').length;
  const burned=await exportVideoCaptionBurnin(f.app,plan,selection,out,{
    confirm_plan_sha256:plan.plan_sha256,
    confirm_r46_zip_sha256:plan.r46_zip_sha256,
    acknowledge_private_export:true
  });
  assert.equal(burned.schema_version,'launchwright-video-caption-burnin-receipt/2');
  assert.equal(burned.caption_locale,'es-MX');
  assert.equal(burned.files_created,2);
  assert.equal(burned.new_native_media_receipt_created,false);
  assert.equal(f.app.list('media_output').length,before);
  assert.equal(burned.technical_state,'UNKNOWN');
  const zipBytes=readFileSync(join(out,burned.zip_filename));
  assert.equal(sha(zipBytes),burned.bundle_sha256);
  const z=await JSZip.loadAsync(zipBytes,{checkCRC32:true});
  const manifest=JSON.parse(await z.file('manifest.json').async('string'));
  assert.equal(manifest.schema_version,'launchwright-video-caption-burnin-package/2');
  assert.equal(manifest.caption_locale,'es-MX');
  assert.equal(manifest.all_caption_glyphs_present_in_font,true);
  assert.equal(manifest.system_font_sha256,plan.system_font_sha256);
  const captionBytes=await z.file('captions.vtt').async('nodebuffer');
  assert.equal(sha(captionBytes),r46.captions_sha256);
  assert.ok(captionBytes.toString('utf8').includes('¡Ya está disponible!'));
  const parent=await JSZip.loadAsync(
    readFileSync(join(f.outDir,original.zip_filename)),{checkCRC32:true});
  const files=join(f.root,'independent-r63');
  mkdirSync(files,{mode:0o700});
  for(const [label,priorName,newName,w,h] of [
    ['landscape','landscape-16x9.mp4','landscape-captioned.mp4',1280,720],
    ['portrait','portrait-9x16.mp4','portrait-captioned.mp4',720,1280]
  ]){
    const oldBytes=await parent.file(priorName).async('nodebuffer');
    const newBytes=await z.file(newName).async('nodebuffer');
    assert.equal(sha(newBytes),manifest.outputs[newName].sha256);
    assert.equal(manifest.outputs[newName].probe.width,w);
    assert.equal(manifest.outputs[newName].probe.height,h);
    const oldPath=join(files,label+'-old.mp4'),
      newPath=join(files,label+'-latin.mp4');
    writeFileSync(oldPath,oldBytes,{mode:0o600});
    writeFileSync(newPath,newBytes,{mode:0o600});
    assert.equal(sha(pcm(oldPath)),sha(pcm(newPath)),
      'R63 must preserve decoded AAC audio exactly');
    const baseline=alteredPixels(frame(oldPath,.2,w,h),frame(newPath,.2,w,h),w,h,.6,1);
    const glyphs=alteredPixels(frame(oldPath,.8,w,h),frame(newPath,.8,w,h),w,h,.6,1);
    assert.ok(glyphs>baseline+200,
      'R63 did not render visibly different approved Latin glyphs: '+JSON.stringify({label,glyphs,baseline}));
    if(label==='portrait'){
      const originalFrame=frame(oldPath,.8,w,h),
        renderedFrame=frame(newPath,.8,w,h);
      const lower=alteredPixels(originalFrame,renderedFrame,w,h,.70,.95);
      const center=alteredPixels(originalFrame,renderedFrame,w,h,.35,.66);
      assert.ok(lower>600,'Portrait Latin captions are not visible in lower letterbox');
      assert.ok(center<300,'Portrait Latin overlay crossed the original central UI surface');
    }
  }
  const replay=await exportVideoCaptionBurnin(f.app,plan,selection,out,{
    confirm_plan_sha256:plan.plan_sha256,
    confirm_r46_zip_sha256:plan.r46_zip_sha256,
    acknowledge_private_export:true
  });
  assert.equal(replay.recovered,true);
  assert.equal(replay.files_created,0);
  assert.equal(replay.bundle_sha256,burned.bundle_sha256);
  assert.equal(f.app.list('media_output').length,before);
});
