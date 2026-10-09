// SPDX-License-Identifier: AGPL-3.0-only
// R46: read-only exact MP4 and caption validation for Native Media custody.
// Semwright Composition owns the original timeline and effects. This module
// creates only an explicitly labelled, derived aspect-ratio export; no agent
// project execution, external providers, voice synthesis or Platform authority.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, writeFileSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { requireCondition as ensure, validateValue, NativeError } from '@semwright/native-sdk';
import { digest } from './base.mjs';
import { execute } from './application.mjs';
import { makeVideoVariantZip } from './video-variant-render.mjs';
export const VIDEO_VARIANTS_SCHEMA='launchwright-video-variants/1';
const sha=x=>createHash('sha256').update(x).digest('hex');
const fullSha=s=>typeof s==='string'&&/^[0-9a-f]{64}$/u.test(s);
const MAX_SOURCE=80*1024*1024;
function privateFile(path,max){
  ensure(typeof path==='string'&&isAbsolute(path)&&path.length<=2048,
    'Source must be an explicitly selected absolute private file','InvalidArgument');
  const st=lstatSync(path);
  ensure(st.isFile()&&!st.isSymbolicLink()&&st.size>20&&st.size<=max&&
    (process.platform==='win32'||(st.mode&0o077)===0),
    'Source must be an owner-only regular 0600 file within the byte budget',
    'PermissionDenied');
  return readFileSync(path);
}
function videoCli(bin,args,{timeout=15000,maxBuffer=200000}={}){
  const r=spawnSync(bin,['-hide_banner','-v','error',...args],{
    timeout,maxBuffer,encoding:'utf8',windowsHide:true,env:{
      ...process.env,AV_LOG_FORCE_NOCOLOR:'1'
    }});
  if(r.error||r.status!==0||typeof r.stdout!=='string')
    throw new NativeError('Unavailable','Bounded local video probe or conversion failed');
  return r.stdout;
}
export function ffmpegVersion(){
  const r=spawnSync('ffmpeg',['-version'],{timeout:4000,maxBuffer:8000,encoding:'utf8'});
  ensure(!r.error&&r.status===0&&r.stdout?.startsWith('ffmpeg version '),
    'Operator must install FFmpeg and validate its version','Unavailable');
  return r.stdout.split('\n')[0].trim().slice(0,160);
}
export function probeLocalMp4(path){
  const raw=videoCli('ffprobe',[
    '-protocol_whitelist','file,pipe',
    '-of','json','-show_entries',
    'format=format_name,duration:stream=index,codec_type,codec_name,width,height,avg_frame_rate,nb_frames,sample_rate',
    path
  ]);
  let record;
  try{record=JSON.parse(raw);}catch{
    throw new NativeError('ProtocolMismatch','ffprobe returned malformed JSON');
  }
  ensure(Array.isArray(record.streams)&&record.streams.length===2,
    'Owned MP4 must have one H.264 video and one AAC audio stream only','InvalidArgument');
  const video=record.streams.find(x=>x.codec_type==='video');
  const audio=record.streams.find(x=>x.codec_type==='audio');
  const duration=Number(record.format?.duration);
  ensure(video?.codec_name==='h264'&&video.width===1280&&video.height===720&&
    video.avg_frame_rate==='30/1'&&
    Number.isSafeInteger(Number(video.nb_frames))&&
    Number(video.nb_frames)>=90&&Number(video.nb_frames)<=900,
    'Video must be an exact 1280x720 H.264 30fps source (90-900 frames)','InvalidArgument');
  ensure(audio?.codec_name==='aac'&&
    Number(audio.sample_rate)===48000,
    'Source must carry approved AAC audio at 48kHz (not synthesized)','InvalidArgument');
  ensure(duration>=2.9&&duration<=30.1 &&
    /(?:^|,)mov(?:,|$)|(?:^|,)mp4(?:,|$)/u.test(record.format?.format_name??''),
    'Media source is not a bounded 3-30s MP4','InvalidArgument');
  return{
    video_codec:video.codec_name,audio_codec:audio.codec_name,
    audio_sample_rate:Number(audio.sample_rate),
    width:video.width,height:video.height,video_frame_rate:video.avg_frame_rate,
    video_frames:Number(video.nb_frames),duration_seconds:duration
  };
}
function timeMs(time){
  const m=/^(\d\d):([0-5]\d):([0-5]\d)\.(\d{3})$/u.exec(time);
  ensure(m,'WebVTT needs canonical HH:MM:SS.mmm times','InvalidArgument');
  return (+m[1]*3600 + +m[2]*60 + +m[3])*1000 + +m[4];
}
export function validateNativeWebVtt(bytes,maxMs){
  ensure(Buffer.isBuffer(bytes)&&bytes.length>0&&bytes.length<=128*1024,
    'Frozen WebVTT must be bounded and nonempty','ResourceExhausted');
  let text;
  try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}
  catch{throw new NativeError('InvalidArgument','WebVTT is not UTF-8');}
  ensure(text.startsWith('WEBVTT\n')&&!text.includes('\r')&&!text.includes('\0'),
    'Native WebVTT must use LF and start with WEBVTT','InvalidArgument');
  const lines=text.split('\n');
  let index=1,previousEnd=0,cues=[];
  while(index<lines.length){
    const line=lines[index].trim();index++;
    if(!line)continue;
    if(line.startsWith('NOTE')){
      while(index<lines.length&&lines[index].trim())index++;
      continue;
    }
    ensure(/^\d+$/u.test(line),'A timed cue must have an integer identifier','InvalidArgument');
    const timings=lines[index++]?.match(/^(\d\d:\d\d:\d\d\.\d{3}) --> (\d\d:\d\d:\d\d\.\d{3})$/u);
    ensure(timings,'WebVTT timing line is missing/unsafe','InvalidArgument');
    const start=timeMs(timings[1]),end=timeMs(timings[2]);
    ensure(start>=previousEnd&&end>start&&end<=maxMs+1,
      'WebVTT captions overlap or exceed the exact media duration','InvalidArgument');
    const caption=[];
    while(index<lines.length&&lines[index].trim())caption.push(lines[index++]);
    ensure(caption.length===1&&caption[0].length<=1000&&!/[<>]/u.test(caption[0]),
      'Native WebVTT cue must contain one escaped, bounded plain line',
      'InvalidArgument');
    cues.push({start_ms:start,end_ms:end,text:caption[0]});
    previousEnd=end;
  }
  ensure(cues.length>=1&&cues.length<=48,
    'At least one, at most 48 well-formed timed cues are required','InvalidArgument');
  return cues;
}
export function inspectVideoInput(app,input){
  validateValue(input);
  ensure(input&&typeof input==='object'&&!Array.isArray(input)&&
    Object.keys(input).sort().join(',')===
      ['acknowledge_audio_rights','acknowledge_technical_unknown',
       'caption_artifact_id','caption_candidate_id','landscape_variant_id',
       'media_output_id','media_plan_id','source_mp4_path','source_mp4_sha256',
       'vertical_variant_id'].sort().join(','),
    'Video variants require exact Native source and consent fields','InvalidArgument');
  ensure(input.acknowledge_audio_rights===true&&
    input.acknowledge_technical_unknown===true,
    'Operator must declare audiovisual rights and UNKNOWN derivative technical state',
    'ConsentRequired');
  const plan=app.get(input.media_plan_id,'media_plan'),output=app.get(input.media_output_id,'media_output');
  ensure(output.data.plan_id===plan.id&&output.data.release_id===plan.data.release_id&&
    output.data.variant_id===input.landscape_variant_id&&
    output.data.variant_kind==='video'&&output.data.state==='SUCCEEDED'&&
    output.data.mime==='video/mp4'&&
    ['UNKNOWN','PASS'].includes(output.data.technical_effective),
    'Input MP4 must be an exact nonfailed Native Media source; known FAIL is never consent-overridable',
    'PermissionDenied');
  const inspected=app.read('media.inspect',{id:plan.id});
  ensure(inspected.source_freshness==='CURRENT'&&
    inspected.variants.find(v=>v.id===input.landscape_variant_id)?.source_freshness==='CURRENT'&&
    inspected.variants.find(v=>v.id===input.vertical_variant_id)?.source_freshness==='CURRENT',
    'One original video source pin is stale','StaleReference');
  const landscapeReview=inspected.variants.find(v=>v.id===input.landscape_variant_id);
  ensure(landscapeReview?.output_id===output.id,
    'Selected source video was superseded by a newer Native Media output',
    'StaleReference');
  ensure(landscapeReview.editorial==='approve-editorial',
    'Latest source video editorial decision must approve these exact bytes',
    'ConsentRequired');
  const landscape=plan.data.variants.find(v=>v.id===input.landscape_variant_id),
    vertical=plan.data.variants.find(v=>v.id===input.vertical_variant_id);
  ensure(landscape?.kind==='video'&&landscape.width===1280&&landscape.height===720&&
    vertical?.kind==='video'&&vertical.width===720&&vertical.height===1280&&
    landscape.locale===vertical.locale,
    'Video Media plan must declare exact 1280x720 and 720x1280 video variants','InvalidArgument');
  ensure(plan.data.frame_rate.num===30&&plan.data.frame_rate.den===1,
    'R46 requires Semwright Media planned frame rate 30/1','InvalidArgument');
  const duration=Number(plan.data.duration.num)/Number(plan.data.duration.den);
  const bytes=privateFile(input.source_mp4_path,MAX_SOURCE);
  ensure(fullSha(input.source_mp4_sha256)&&sha(bytes)===input.source_mp4_sha256&&
    input.source_mp4_sha256===output.data.artifact_sha256,
    'Private MP4 differs from the exact Native Media output digest','Conflict');
  const checked=probeLocalMp4(input.source_mp4_path);
  ensure(Math.abs(checked.duration_seconds-duration)<=0.08&&
    checked.video_frames===Math.round(duration*30),
    'Source MP4 duration/frame count differs from the Media plan','Conflict');
  const reviews=app.list('media_review',plan.data.release_id).filter(r=>
    r.data.output_id===output.id&&r.data.artifact_sha256===output.data.artifact_sha256 &&
    r.data.decision==='approve-editorial');
  ensure(reviews.length>0,
    'Source MP4 needs an exact separate human editorial approval','ConsentRequired');
  const candidate=app.get(input.caption_candidate_id,'candidate'),
    artifact=app.get(input.caption_artifact_id,'artifact');
  ensure(candidate.data.release_id===plan.data.release_id&&
    artifact.data.release_id===plan.data.release_id&&
    artifact.data.target_id===plan.data.target_id,
    'Captions belong to another release','PermissionDenied');
  const frozen=candidate.data.manifest.artifacts?.find(x=>x.id===artifact.id);
  ensure(frozen?.sha256===artifact.data.sha256&&
    frozen.bytes===artifact.data.size_bytes&&
    candidate.data.manifest.artifact_ids.includes(artifact.id)&&
    artifact.data.mime?.split(';')[0]==='text/vtt',
    'Caption source must be exact frozen Native WebVTT','PermissionDenied');
  const candidateStatus=app.inspectCandidate(candidate);
  ensure(candidateStatus.fresh&&candidateStatus.private_draft_allowed,
    'Caption source no longer matches frozen candidate revisions',
    'StaleReference');
  ensure(candidateStatus.editorial_review.state==='APPROVED_EDITORIAL',
    'Caption source needs explicit editorial approval on exact candidate',
    'ConsentRequired');
  const vtt=app.store.readBlob(artifact.data.sha256).bytes;
  ensure(sha(vtt)===artifact.data.sha256,
    'Frozen source captions digest changed','Conflict');
  const cues=validateNativeWebVtt(vtt,Math.round(duration*1000));
  return{
    plan,output,candidate,artifact,source_mp4:bytes,vtt,
    source_probe:checked,cue_count:cues.length,
    technical_state:'UNKNOWN',duration_seconds:duration
  };
}
export function planVideoVariants(app,input){
  const inspected=inspectVideoInput(app,input);
  const data={
    schema_version:VIDEO_VARIANTS_SCHEMA,
    media_plan_id:inspected.plan.id,
    media_plan_digest:inspected.plan.data.plan_digest,
    release_id:inspected.plan.data.release_id,
    source_output_id:inspected.output.id,
    source_mp4_sha256:sha(inspected.source_mp4),
    source_mp4_bytes:inspected.source_mp4.length,
    source_path_sha256:sha(Buffer.from(input.source_mp4_path)),
    captions_candidate_id:inspected.candidate.id,
    captions_candidate_sha256:inspected.candidate.data.candidate_sha256,
    captions_artifact_id:inspected.artifact.id,
    captions_sha256:sha(inspected.vtt),captions_cues:inspected.cue_count,
    landscape_variant_id:input.landscape_variant_id,
    vertical_variant_id:input.vertical_variant_id,
    landscape_dimensions:'1280x720',vertical_dimensions:'720x1280',
    duration_seconds:inspected.duration_seconds,
    frames:inspected.source_probe.video_frames,
    input_ffmpeg_version:ffmpegVersion(),
    source_technical_state:inspected.output.data.technical_effective,
    derivative_technical_state:'UNKNOWN',
    source_audio_preserved:true,alternate_voice_created:false,
    subtitle_sidecar_only:true,burned_in_captions:false,
    operator_audio_rights_declaration:true,
    operator_acknowledged_unknown:true,
    platform_authority:false,publication_authority:false,
    external_network_access:false,source_app_scripts_executed:false
  };
  return {...data,plan_sha256:digest('video-variants',data)};
}
export function verifyVideoPlan(app,plan,input){
  validateValue(plan);
  ensure(plan&&typeof plan==='object'&&!Array.isArray(plan),
    'Video plan must be exact JSON','InvalidArgument');
  const {plan_sha256,...data}=plan;
  ensure(fullSha(plan_sha256)&&digest('video-variants',data)===plan_sha256,
    'Video variant plan was modified','Conflict');
  const expected=planVideoVariants(app,input);
  ensure(JSON.stringify(expected)===JSON.stringify(plan),
    'Media plan, source MP4, caption bytes or FFmpeg toolchain changed',
    'StaleReference');
  return expected;
}

function privateOutputDir(path){
  ensure(typeof path==='string'&&isAbsolute(path)&&path.length<2048,
    'Output requires an existing absolute private directory','InvalidArgument');
  const st=lstatSync(path);
  ensure(st.isDirectory()&&!st.isSymbolicLink()&&
    (process.platform==='win32'||(st.mode&0o077)===0),
    'Output directory must be private 0700 and not a symbolic link',
    'PermissionDenied');
  return path;
}
export async function exportVideoVariants(app,plan,input,outDir,{
  confirm_plan_sha256,confirm_source_mp4_sha256,acknowledge_private_export=false
}={}){
  verifyVideoPlan(app,plan,input);
  ensure(confirm_plan_sha256===plan.plan_sha256&&
    confirm_source_mp4_sha256===plan.source_mp4_sha256&&
    acknowledge_private_export===true,
    'Operator must confirm exact plan and source MP4 digest before output',
    'ConsentRequired');
  const directory=privateOutputDir(outDir),lock=join(app.store.root,'.video-variants-apply.lock');
  let fd;
  try{fd=openSync(lock,'wx',0o600);}
  catch{throw new NativeError('Conflict','Another video variant export is active or its stale lock needs human review');}
  try{
    // Validate again after acquiring the lock; never inherit an upstream
    // canonical Composition technical PASS for this derived variant.
    const source=inspectVideoInput(app,input);
    const prior=app.list('media_output',plan.release_id).filter(o=>
      o.data.plan_id===plan.media_plan_id&&o.data.variant_id===plan.vertical_variant_id);
    ensure(prior.length<=1 &&
      (!prior.length || (prior[0].data.authority==='imported'&&
      prior[0].data.state==='SUCCEEDED'&&
      prior[0].data.provider==='launchwright-spatial-derivative'&&
      prior[0].data.technical_effective==='UNKNOWN'&&
      prior[0].data.mime==='video/mp4')),
      'Existing native portrait output has incompatible authority/identity','Conflict');
    const derived=await makeVideoVariantZip(source,plan,input.source_mp4_path,directory);
    // An independent Media author can revise source/approval during the
    // bounded FFmpeg conversion; re-evaluate source before writing files.
    verifyVideoPlan(app,plan,input);
    const now=app.list('media_output',plan.release_id).filter(o=>
      o.data.plan_id===plan.media_plan_id&&o.data.variant_id===plan.vertical_variant_id);
    ensure(now.length===prior.length&&
      now.every((v,i)=>v.id===prior[i].id),
      'Portrait output changed while converting; no files were written',
      'StaleReference');
    const portrait=derived.manifest.outputs['portrait-9x16.mp4'];
    ensure(!prior.length||prior[0].data.artifact_sha256===portrait.sha256,
      'Another portrait Media output already claims this source variant','Conflict');
    const name='launchwright-video-'+plan.plan_sha256.slice(0,12);
    const receipt={
      schema_version:'launchwright-video-variants-receipt/1',
      plan_sha256:plan.plan_sha256,
      media_plan_id:plan.media_plan_id,media_plan_digest:plan.media_plan_digest,
      source_output_id:plan.source_output_id,
      source_mp4_sha256:plan.source_mp4_sha256,
      captions_candidate_sha256:plan.captions_candidate_sha256,
      captions_sha256:plan.captions_sha256,
      zip_sha256:derived.zip_sha256,zip_bytes:derived.bytes.length,
      portrait_mp4_sha256:portrait.sha256,
      landscape_format:'1280x720 H264/AAC 30fps',
      portrait_format:'720x1280 H264/AAC 30fps (contained)',
      captions_format:'sidecar WebVTT, not burned in',
      original_audio_retained:true,alternate_voice_generated:false,
      source_timeline_recomposed:false,
      local_technical_state:'UNKNOWN',
      editorial_state:'PENDING_DERIVED_VARIANT_REVIEW',
      exact_media_custody:true,
      source_app_scripts_executed:false,external_network_access:false,
      platform_authority:false,published:false
    };
    const files=[
      {name:name+'.zip',bytes:derived.bytes},
      {name:name+'.receipt.json',bytes:Buffer.from(JSON.stringify(receipt,null,2)+'\n')}
    ];
    for(const item of files){
      const path=join(directory,item.name);
      if(!existsSync(path))continue;
      const stat=lstatSync(path);
      ensure(stat.isFile()&&!stat.isSymbolicLink()&&
        (process.platform==='win32'||(stat.mode&0o077)===0)&&
        sha(readFileSync(path))===sha(item.bytes),
        'Existing private video output was changed and cannot be overwritten',
        'Conflict');
    }
    let written=0;
    for(const item of files){
      const path=join(directory,item.name);
      if(existsSync(path))continue;
      writeFileSync(path,item.bytes,{mode:0o600,flag:'wx'});
      written++;
    }
    const media=prior[0]??(await execute(app,'media.output_record',{
      plan_id:plan.media_plan_id,
      variant_id:plan.vertical_variant_id,
      state:'SUCCEEDED',authority:'imported',
      provider:'launchwright-spatial-derivative',provider_version:'r46',
      artifact_sha256:portrait.sha256,mime:'video/mp4',
      duration:source.plan.data.duration,
      observed_at:new Date().toISOString(),
      reported_verification:'UNKNOWN'
    })).entity;
    return{
      ...receipt,
      media_output_id:media.id,
      media_output_created:prior.length===0,
      files_created:written,
      recovered:written===0,
      zip_filename:files[0].name,
      human_review_required:true,
      technical_state:'UNKNOWN'
    };
  }finally{
    try{closeSync(fd);}finally{unlinkSync(lock);}
  }
}
