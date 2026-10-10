// SPDX-License-Identifier: AGPL-3.0-only
// R62: optional privately caption-burned MP4s from an EXACT R46 output and
// frozen Semwright Native SDK Media/VTT source. This is a formatting-only
// FFmpeg derivative, NOT a Composition renderer, verifier or publication.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync, lstatSync, realpathSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
  openSync, closeSync, unlinkSync
} from 'node:fs';
import { isAbsolute, join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import JSZip from 'jszip';
import { requireCondition as ensure, validateValue, NativeError } from '@semwright/native-sdk';
import { digest } from './base.mjs';
import {
  verifyVideoPlan,inspectVideoInput,validateNativeWebVtt,ffmpegVersion
} from './video-variants.mjs';

export const BURNIN_SCHEMA='launchwright-source-caption-burnin/1';
export const BURNIN_LATIN_SCHEMA='launchwright-source-caption-burnin/2';
const LATIN_POLICY='approved-nfc-latin/1';
const LATIN_LOCALES=/^(?:en|es|fr|pt|de|it|nl|ca|gl)(?:-[A-Za-z0-9]{2,8})*$/u;
// Explicit DejaVu-covered Latin-1 + common Latin Extended glyphs. Never
// accept controls, bidi, emojis, ASS braces or arbitrary Unicode scripts.
const LATIN_TEXT=/^[A-Za-z0-9 À-ÖØ-öø-ÿŒœŠšŸŽžĄąĆćĘęŁłŃńŚśŹźŻż.,;:!?"'¿¡()/%+‘’“”\-–—…]+$/u;
function installedLatinFont(cues){
  ensure(process.platform==='linux',
    'R63 Latin caption profile currently requires a verified Linux fontconfig host',
    'Unavailable');
  const call=spawnSync('fc-match',['-f','%{family}\\n%{file}\\n','DejaVu Sans'],{
    encoding:'utf8',timeout:5000,maxBuffer:4096,
    env:{...process.env,LC_ALL:'C.UTF-8'}
  });
  ensure(!call.error&&call.status===0,'Unable to verify installed DejaVu font','Unavailable');
  const [family,sourcePath]=call.stdout.trim().split(String.fromCharCode(10));
  ensure(family?.split(',')[0]==='DejaVu Sans'&&
    typeof sourcePath==='string'&&isAbsolute(sourcePath),
    'The installed Latin caption font family or path does not match the approved DejaVu profile',
    'Unavailable');
  const path=realpathSync(sourcePath);
  ensure(path.startsWith('/usr/share/fonts/')&&basename(path)==='DejaVuSans.ttf',
    'R63 requires the system-shipped DejaVuSans.ttf, not an arbitrary operator font',
    'PermissionDenied');
  const stat=lstatSync(path);
  ensure(stat.isFile()&&!stat.isSymbolicLink()&&stat.size>50000&&
    stat.size<=10*1024*1024,
    'The pinned system font is invalid or exceeds its byte budget','Unavailable');
  const fontQuery=spawnSync('fc-query',['-f','%{charset}\\n',path],{
    encoding:'utf8',timeout:5000,maxBuffer:16384,
    env:{...process.env,LC_ALL:'C.UTF-8'}
  });
  ensure(!fontQuery.error&&fontQuery.status===0,
    'Unable to verify actual glyph coverage in pinned host font','Unavailable');
  const ranges=fontQuery.stdout.trim().split(/\s+/u).map(token=>{
    const match=/^([0-9a-f]{1,6})(?:-([0-9a-f]{1,6}))?$/iu.exec(token);
    ensure(match,'Fontconfig returned an invalid glyph coverage range','ProtocolMismatch');
    return [parseInt(match[1],16),parseInt(match[2]??match[1],16)];
  });
  ensure(ranges.length>30,'Installed font returned an incomplete glyph coverage map','Unavailable');
  for(const cue of cues){
    for(const character of cue.text){
      const code=character.codePointAt(0);
      ensure(ranges.some(([first,last])=>first<=code&&code<=last),
        'Pinned DejaVu Sans font cannot draw an approved Latin caption glyph; never display tofu/omissions',
        'InvalidArgument');
    }
  }
  return{font_family:'DejaVu Sans',font_file_sha256:sha(readFileSync(path)),
    policy:LATIN_POLICY,glyph_coverage_checked:true};
}

const sha=value=>createHash('sha256').update(value).digest('hex');
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/u.test(value);
const FIXED_DATE=new Date('2000-01-01T00:00:00.000Z');

function privateFile(path,cap){
  ensure(typeof path==='string'&&isAbsolute(path)&&path.length<=2048,
    'Source media path must be an absolute private file','InvalidArgument');
  const st=lstatSync(path);
  ensure(st.isFile()&&!st.isSymbolicLink()&&st.size>0&&st.size<=cap&&
    (process.platform==='win32'||(st.mode&0o077)===0),
    'Media/receipt file must be private 0600 and within its fixed byte budget',
    'PermissionDenied');
  return readFileSync(path);
}
function privateDirectory(path){
  ensure(typeof path==='string'&&isAbsolute(path)&&path.length<=2048,
    'An existing private absolute output directory is required','InvalidArgument');
  const st=lstatSync(path);
  ensure(st.isDirectory()&&!st.isSymbolicLink()&&
    (process.platform==='win32'||(st.mode&0o077)===0),
    'Output directory must be private 0700, not a symlink','PermissionDenied');
  return path;
}
function run(bin,args,timeout=15000){
  const call=spawnSync(bin,args,{
    encoding:'utf8',timeout,maxBuffer:1024*1024,
    windowsHide:true,
    env:{...process.env,GIT_TERMINAL_PROMPT:'0',AV_LOG_FORCE_NOCOLOR:'1'}
  });
  if(call.error||call.status!==0)
    throw new NativeError('Unavailable',
      'Exact owned FFmpeg caption conversion or probe failed; original source was not modified');
  return call.stdout;
}
export function strictBurninCues(vtt,durationMillis,policy='ascii'){
  const cues=validateNativeWebVtt(vtt,durationMillis);
  ensure(cues.length>=1&&cues.length<=20,
    'Caption overlay requires 1–20 source-approved cue windows','ResourceExhausted');
  for(const cue of cues){
    ensure(typeof cue.text==='string'&&cue.text.length>=2&&cue.text.length<=85,
      'A source caption must be 2–85 visible characters','InvalidArgument');
    if(policy==='latin'){
      ensure(cue.text.normalize('NFC')===cue.text&&LATIN_TEXT.test(cue.text),
        'R63 Latin overlay requires NFC plain Latin text and approved readable punctuation; emojis, bidi, other scripts and markup fail closed',
        'InvalidArgument');
    }else{
      ensure(policy==='ascii'&&/^[\x20-\x7e]+$/u.test(cue.text),
        'Source WebVTT has an unsupported glyph or overly long overlay line',
        'InvalidArgument');
    }
    ensure(!cue.text.includes('\\')&&!/[{}]/u.test(cue.text),
      'Source caption contains potential ASS styling/control syntax',
      'InvalidArgument');
    ensure(cue.end_ms-cue.start_ms>=300,
      'Caption cue is too short for a readable overlay','InvalidArgument');
  }
  return cues;
}
async function inspectR46(app,r46Plan,r46Input,dir,policy='ascii'){
  verifyVideoPlan(app,r46Plan,r46Input);
  const original=inspectVideoInput(app,r46Input);
  privateDirectory(dir);
  const prefix='launchwright-video-'+r46Plan.plan_sha256.slice(0,12);
  const receiptBytes=privateFile(join(dir,prefix+'.receipt.json'),128*1024);
  let receipt;
  try{receipt=JSON.parse(receiptBytes.toString('utf8'));}
  catch{throw new NativeError('InvalidArgument','R46 receipt is not valid private JSON');}
  validateValue(receipt);
  ensure(receipt.schema_version==='launchwright-video-variants-receipt/1'&&
    receipt.plan_sha256===r46Plan.plan_sha256&&
    receipt.media_plan_digest===r46Plan.media_plan_digest&&
    receipt.source_output_id===r46Plan.source_output_id&&
    receipt.source_mp4_sha256===r46Plan.source_mp4_sha256&&
    receipt.captions_sha256===r46Plan.captions_sha256&&
    receipt.local_technical_state==='UNKNOWN'&&
    receipt.captions_format==='sidecar WebVTT, not burned in'&&
    hex(receipt.zip_sha256)&&hex(receipt.portrait_mp4_sha256),
    'R46 package receipt disagrees with original Native Media/Candidate authority','Conflict');
  const zipped=privateFile(join(dir,prefix+'.zip'),160*1024*1024);
  ensure(sha(zipped)===receipt.zip_sha256,
    'R46 private video ZIP differs from its hashed receipt','Conflict');
  const zip=await JSZip.loadAsync(zipped,{checkCRC32:true});
  const expectedNames=['README.txt','captions.vtt','landscape-16x9.mp4',
    'manifest.json','portrait-9x16.mp4'];
  ensure(JSON.stringify(Object.keys(zip.files).sort())===JSON.stringify(expectedNames),
    'R46 ZIP contains unexpected or missing media entries','Conflict');
  const landscape=await zip.file('landscape-16x9.mp4').async('nodebuffer');
  const portrait=await zip.file('portrait-9x16.mp4').async('nodebuffer');
  const vtt=await zip.file('captions.vtt').async('nodebuffer');
  let manifest;
  try{manifest=JSON.parse(await zip.file('manifest.json').async('string'));}
  catch{throw new NativeError('InvalidArgument','R46 manifest is malformed');}
  ensure(manifest.schema_version==='launchwright-video-variants-package/1'&&
    manifest.plan_sha256===r46Plan.plan_sha256 &&
    manifest.media_plan_digest===r46Plan.media_plan_digest &&
    manifest.outputs?.['landscape-16x9.mp4']?.sha256===sha(landscape) &&
    manifest.outputs?.['portrait-9x16.mp4']?.sha256===sha(portrait) &&
    manifest.outputs?.['captions.vtt']?.sha256===sha(vtt) &&
    sha(landscape)===r46Plan.source_mp4_sha256 &&
    sha(portrait)===receipt.portrait_mp4_sha256 &&
    sha(vtt)===r46Plan.captions_sha256 &&
    sha(vtt)===sha(original.vtt) &&
    original.candidate.data.candidate_sha256===r46Plan.captions_candidate_sha256,
    'R46 ZIP, approved Native WebVTT or original video source bytes differ',
    'Conflict');
  const cues=strictBurninCues(vtt,Math.round(r46Plan.duration_seconds*1000),policy);
  return{original,receipt,landscape,portrait,vtt,cues,manifest,
    r46_zip_sha256:sha(zipped),r46_receipt_sha256:sha(receiptBytes)};
}
async function planBurnin(app,{
  r46_plan,r46_input,r46_dir,
  acknowledge_caption_review=false,acknowledge_video_privacy_unknown=false,
  acknowledge_private_only=false,acknowledge_latin_glyph_review=false
}={},policy='ascii'){
  ensure(acknowledge_caption_review===true &&
    acknowledge_video_privacy_unknown===true &&
    acknowledge_private_only===true,
    'Independent operator approval of the exact captions, residual privacy and private-only output is required',
    'ConsentRequired');
  ensure(policy==='ascii'||policy==='latin','Unrecognized subtitle character policy','InvalidArgument');
  if(policy==='latin')ensure(acknowledge_latin_glyph_review===true,
    'Operator must independently approve the Latin glyph/font/locale review boundary',
    'ConsentRequired');
  const data=await inspectR46(app,r46_plan,r46_input,r46_dir,policy);
  let latin=null,locale=null;
  if(policy==='latin'){
    const media=data.original.plan;
    const a=media.data.variants.find(v=>v.id===r46_input.landscape_variant_id);
    const b=media.data.variants.find(v=>v.id===r46_input.vertical_variant_id);
    const target=app.get(media.data.target_id,'target');
    locale=a?.locale;
    ensure(LATIN_LOCALES.test(locale??'')&&b?.locale===locale&&
      target.data.editorial_locale===locale,
      'R63 subtitle language must be a supported real matching Native Media/target editorial locale',
      'Conflict');
    latin=installedLatinFont(data.cues);
  }
  const core={
    schema_version:BURNIN_SCHEMA,
    r46_plan_sha256:r46_plan.plan_sha256,
    r46_zip_sha256:data.r46_zip_sha256,
    r46_receipt_sha256:data.r46_receipt_sha256,
    media_plan_id:r46_plan.media_plan_id,
    media_plan_digest:r46_plan.media_plan_digest,
    native_source_output_id:r46_plan.source_output_id,
    caption_candidate_sha256:r46_plan.captions_candidate_sha256,
    vtt_sha256:r46_plan.captions_sha256,
    landscape_source_sha256:sha(data.landscape),
    portrait_source_sha256:sha(data.portrait),
    frames:r46_plan.frames,
    duration_seconds:r46_plan.duration_seconds,
    cue_count:data.cues.length,
    cue_windows_sha256:digest('burnin-cue-windows',data.cues),
    font_family:'DejaVu Sans',
    subtitle_style:'fixed-readable-contrast/2',
    ffmpeg_version:ffmpegVersion(),
    operator_caption_review_declared:true,
    operator_video_privacy_unknown_declared:true,
    private_only:true,
    burned_captions_actual:true,
    original_video_mutated:false,
    original_audio_preserved:true,
    technical_state:'UNKNOWN',
    general_privacy_verified:false,
    semantic_claims_verified:false,
    customer_acceptance:false,
    platform_publish_authority:false,
    external_network_access:false
  };
  if(policy==='latin'){
    core.schema_version=BURNIN_LATIN_SCHEMA;
    core.subtitle_style='fixed-readable-latin/1';
    core.charset_policy=latin.policy;
    core.caption_locale=locale;
    core.system_font_sha256=latin.font_file_sha256;
    core.all_caption_glyphs_present_in_font=latin.glyph_coverage_checked;
    core.operator_latin_glyph_review_declared=true;
  }
  return{...core,plan_sha256:digest(policy==='latin'?'video-caption-burnin-latin':'video-caption-burnin',core)};
}
export const planVideoCaptionBurnin=(app,options)=>planBurnin(app,options,'ascii');
export const planVideoCaptionBurninLatin=(app,options)=>planBurnin(app,options,'latin');
export async function verifyVideoCaptionBurnin(app,plan,options){
  validateValue(plan);
  ensure(plan&&typeof plan==='object'&&!Array.isArray(plan),
    'Saved burn-in plan must be valid JSON','InvalidArgument');
  const {plan_sha256,...core}=plan;
  const isLatin=core.schema_version===BURNIN_LATIN_SCHEMA;
  ensure([BURNIN_SCHEMA,BURNIN_LATIN_SCHEMA].includes(core.schema_version)&&
    hex(plan_sha256)&&
    digest(isLatin?'video-caption-burnin-latin':'video-caption-burnin',core)===plan_sha256,
    'Saved burn-in intent digest or metadata was changed','Conflict');
  const exact=await (isLatin?planVideoCaptionBurninLatin:planVideoCaptionBurnin)(app,options);
  ensure(JSON.stringify(exact)===JSON.stringify(plan),
    'Native source, R46 video package, toolchain or original captions drifted',
    'StaleReference');
  return plan;
}
function ffprobeOwned(path,width,height,frames,duration){
  const record=JSON.parse(run('ffprobe',[
    '-hide_banner','-v','error','-protocol_whitelist','file,pipe',
    '-show_entries','format=duration:stream=codec_name,codec_type,width,height,avg_frame_rate,nb_frames,sample_rate',
    '-of','json',path
  ]));
  const video=record.streams?.find(x=>x.codec_type==='video'),
    audio=record.streams?.find(x=>x.codec_type==='audio');
  ensure(record.streams?.length===2&&video?.codec_name==='h264'&&
    video.width===width&&video.height===height&&video.avg_frame_rate==='30/1'&&
    Number(video.nb_frames)===frames&&audio?.codec_name==='aac'&&
    Number(audio.sample_rate)===48000&&
    Math.abs(Number(record.format?.duration)-duration)<0.08,
    'Captioned MP4 changed source time, frame count, AAC or dimensions',
    'Conflict');
  return{width,height,frames,frame_rate:'30/1',audio_codec:'aac',
    duration_seconds:Number(record.format.duration)};
}
function renderOne(input,output,captionPath,width,height,frames,duration){
  const fontSize=width===1280?18:10;
  const margin=width===1280?28:55;
  const path=captionPath;
  ensure(/^[\/A-Za-z0-9_.-]+$/u.test(path),
    'The privately generated temporary caption path is unsafe for an FFmpeg filter',
    'InvalidArgument');
  const filter='subtitles=filename='+path+
    ":force_style='FontName=DejaVu Sans,FontSize="+fontSize+
    ',PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,'+
    'Outline=2,Shadow=0,Alignment=2,MarginV='+margin+"'";
  run('ffmpeg',[
    '-hide_banner','-nostdin','-v','error','-xerror',
    '-protocol_whitelist','file,pipe',
    '-i',input,
    '-map','0:v:0','-map','0:a:0',
    '-map_metadata','-1','-map_chapters','-1',
    '-vf',filter,
    '-frames:v',String(frames),
    '-c:v','libx264','-preset','medium','-crf','20',
    '-threads','1','-pix_fmt','yuv420p',
    '-x264-params','scenecut=0:open-gop=0',
    '-c:a','copy',
    '-metadata','creation_time=2000-01-01T00:00:00Z',
    '-movflags','+faststart','-f','mp4','-y',output
  ],120000);
  const probe=ffprobeOwned(output,width,height,frames,duration);
  const bytes=readFileSync(output);
  ensure(bytes.length>=2048&&bytes.length<=80*1024*1024,
    'Captioned MP4 is missing or over 80 MiB','ResourceExhausted');
  return{bytes,probe};
}
async function createBundle(data,plan){
  ensure(process.platform==='linux',
    'R62 video subtitle burn-in currently runs only on verified Linux FFmpeg/libass hosts',
    'Unavailable');
  const dir=mkdtempSync(join(tmpdir(),'lw-r62-burnin-'));
  try{
    const captions=join(dir,'captions.vtt');
    const landscapeInput=join(dir,'landscape.mp4'),
      portraitInput=join(dir,'portrait.mp4');
    writeFileSync(captions,data.vtt,{mode:0o600,flag:'wx'});
    writeFileSync(landscapeInput,data.landscape,{mode:0o600,flag:'wx'});
    writeFileSync(portraitInput,data.portrait,{mode:0o600,flag:'wx'});
    const horizontal=renderOne(landscapeInput,join(dir,'landscape-cc.mp4'),
      captions,1280,720,plan.frames,plan.duration_seconds);
    const vertical=renderOne(portraitInput,join(dir,'portrait-cc.mp4'),
      captions,720,1280,plan.frames,plan.duration_seconds);
    const entries=[
      {name:'landscape-captioned.mp4',bytes:horizontal.bytes},
      {name:'portrait-captioned.mp4',bytes:vertical.bytes},
      {name:'captions.vtt',bytes:data.vtt}
    ];
    const manifest={
      schema_version:plan.schema_version===BURNIN_LATIN_SCHEMA?
        'launchwright-video-caption-burnin-package/2':
        'launchwright-video-caption-burnin-package/1',
      plan_sha256:plan.plan_sha256,
      source_r46_plan_sha256:plan.r46_plan_sha256,
      source_r46_zip_sha256:plan.r46_zip_sha256,
      source_r46_receipt_sha256:plan.r46_receipt_sha256,
      media_plan_digest:plan.media_plan_digest,
      native_source_output_id:plan.native_source_output_id,
      caption_candidate_sha256:plan.caption_candidate_sha256,
      caption_vtt_sha256:plan.vtt_sha256,
      cue_windows_sha256:plan.cue_windows_sha256,
      original_audio_preserved:true,
      captions_burned_in:true,subtitle_sidecar_preserved:true,
      outputs:{
        'landscape-captioned.mp4':{sha256:sha(horizontal.bytes),
          bytes:horizontal.bytes.length,probe:horizontal.probe},
        'portrait-captioned.mp4':{sha256:sha(vertical.bytes),
          bytes:vertical.bytes.length,probe:vertical.probe},
        'captions.vtt':{sha256:sha(data.vtt),bytes:data.vtt.length}
      },
      technical_state:'UNKNOWN',caption_visual_review_pending:true,
      portrait_captions_expected_in_lower_letterbox:true,
      caption_style_version:plan.subtitle_style,
      ...(plan.schema_version===BURNIN_LATIN_SCHEMA?{
        charset_policy:plan.charset_policy,caption_locale:plan.caption_locale,
        system_font_sha256:plan.system_font_sha256,
        all_caption_glyphs_present_in_font:plan.all_caption_glyphs_present_in_font}:{}),
      voice_changed:false,source_timeline_recomposed:false,
      original_source_modified:false,
      independent_privacy_review:false,customer_acceptance:false,
      external_publication:false,platform_authority:false
    };
    entries.push({name:'manifest.json',bytes:Buffer.from(JSON.stringify(manifest,null,2)+'\n')});
    entries.push({name:'README.txt',bytes:Buffer.from(
      (plan.schema_version===BURNIN_LATIN_SCHEMA?
        'LAUNCHWRIGHT R63 PRIVATE LATIN NFC CAPTION BURN-IN\n':
        'LAUNCHWRIGHT R62 PRIVATE VIDEO CAPTION BURN-IN\n')+
      'Two FFmpeg-produced video derivatives with rendered WebVTT text and original AAC audio.\n'+
      'Human readable-caption, video privacy, rights and product-behavior review still required.\n'+
      'Imported UNKNOWN output. No Semwright Composition re-render, Platform job or publication.\n','utf8')});
    const zip=new JSZip();
    for(const entry of entries)zip.file(entry.name,entry.bytes,{
      date:FIXED_DATE,unixPermissions:'0600'
    });
    const bytes=Buffer.from(await zip.generateAsync({
      type:'nodebuffer',platform:'UNIX',compression:'DEFLATE',
      compressionOptions:{level:6}
    }));
    ensure(bytes.length<=170*1024*1024,
      'Caption video bundle exceeds 170 MiB','ResourceExhausted');
    const unpacked=await JSZip.loadAsync(bytes,{checkCRC32:true});
    ensure(JSON.stringify(Object.keys(unpacked.files).sort())===
      JSON.stringify(entries.map(x=>x.name).sort()),
      'Caption burn-in bundle includes extra or missing files','ProtocolMismatch');
    for(const entry of entries){
      const observed=await unpacked.file(entry.name).async('nodebuffer');
      ensure(observed.equals(entry.bytes),'Captioned source bytes differ on ZIP readback','Conflict');
    }
    return{bytes,manifest,bundle_sha256:sha(bytes)};
  }finally{rmSync(dir,{recursive:true,force:true,maxRetries:5,retryDelay:50});}
}
export async function exportVideoCaptionBurnin(app,plan,options,outDir,{
  confirm_plan_sha256,confirm_r46_zip_sha256,
  acknowledge_private_export=false
}={}){
  await verifyVideoCaptionBurnin(app,plan,options);
  ensure(confirm_plan_sha256===plan.plan_sha256 &&
    confirm_r46_zip_sha256===plan.r46_zip_sha256&&
    acknowledge_private_export===true,
    'Operator must separately confirm exact burn-in plan, original R46 ZIP SHA and private export',
    'ConsentRequired');
  const dir=privateDirectory(outDir),lock=join(app.store.root,'.video-caption-burnin.lock');
  let fd=null;
  try{fd=openSync(lock,'wx',0o600);}
  catch{throw new NativeError('Conflict',
    'Another caption burn-in is active or the stale lock requires manual review');}
  try{
    const data=await inspectR46(app,options.r46_plan,options.r46_input,options.r46_dir,
      plan.schema_version===BURNIN_LATIN_SCHEMA?'latin':'ascii');
    const output=await createBundle(data,plan);
    // Verify source *again* after time-consuming media conversion so
    // concurrent edits to Native source or media packages are not accepted.
    await verifyVideoCaptionBurnin(app,plan,options);
    const stem='launchwright-caption-burnin-'+plan.plan_sha256.slice(0,12);
    const receipt={
      schema_version:plan.schema_version===BURNIN_LATIN_SCHEMA?
        'launchwright-video-caption-burnin-receipt/2':
        'launchwright-video-caption-burnin-receipt/1',
      plan_sha256:plan.plan_sha256,
      source_r46_zip_sha256:plan.r46_zip_sha256,
      media_plan_digest:plan.media_plan_digest,
      native_source_output_id:plan.native_source_output_id,
      captions_sha256:plan.vtt_sha256,
      bundle_sha256:output.bundle_sha256,
      bundle_bytes:output.bytes.length,
      output_files:output.manifest.outputs,
      source_audio_preserved:true,captions_burned_in:true,
      ...(plan.schema_version===BURNIN_LATIN_SCHEMA?{
        caption_locale:plan.caption_locale,charset_policy:plan.charset_policy,
        system_font_sha256:plan.system_font_sha256,
        all_caption_glyphs_present_in_font:plan.all_caption_glyphs_present_in_font}:{}),
      new_native_media_receipt_created:false,
      technical_state:'UNKNOWN',human_review_pending:true,
      source_app_scripts_executed:false,external_network_access:false,
      published:false,platform_authority:false
    };
    const assets=[
      {name:stem+'.zip',bytes:output.bytes},
      {name:stem+'.receipt.json',bytes:Buffer.from(JSON.stringify(receipt,null,2)+'\n')}
    ];
    for(const entry of assets){
      const file=join(dir,entry.name);
      if(!existsSync(file))continue;
      const stat=lstatSync(file);
      ensure(stat.isFile()&&!stat.isSymbolicLink()&&
        (process.platform==='win32'||(stat.mode&0o077)===0)&&
        sha(readFileSync(file))===sha(entry.bytes),
        'A human-edited or conflicting caption video bundle already exists',
        'Conflict');
    }
    let created=0;
    for(const entry of assets){
      const file=join(dir,entry.name);
      if(existsSync(file))continue;
      writeFileSync(file,entry.bytes,{flag:'wx',mode:0o600});
      created++;
    }
    return{...receipt,zip_filename:assets[0].name,files_created:created,
      recovered:created===0};
  }finally{
    try{closeSync(fd);}finally{unlinkSync(lock);}
  }
}
