// SPDX-License-Identifier: AGPL-3.0-only
// R46 bounded FFmpeg FORMAT-ONLY derivative from an exact Native Media MP4.
// This is NOT an alternate Semwright Composition timeline/rendering engine.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import JSZip from 'jszip';
import { requireCondition as ensure, NativeError } from '@semwright/native-sdk';

const sha=v=>createHash('sha256').update(v).digest('hex');
const fixedDate=new Date('2000-01-01T00:00:00.000Z');
function run(program,args,timeout=120000){
  const proc=spawnSync(program,args,{
    windowsHide:true,timeout,maxBuffer:1024*1024,encoding:'utf8',
    env:{...process.env,AV_LOG_FORCE_NOCOLOR:'1'}
  });
  if(proc.error||proc.status!==0)
    throw new NativeError('Unavailable',
      'Bounded local video conversion or verification failed; original Media source was not modified');
  return proc.stdout;
}
function checkVertical(path,frames,duration){
  const response=run('ffprobe',[
    '-hide_banner','-v','error',
    '-protocol_whitelist','file,pipe',
    '-show_entries','stream=codec_type,codec_name,width,height,avg_frame_rate,nb_frames,sample_rate:format=duration',
    '-of','json',path
  ],15000);
  let record;
  try{record=JSON.parse(response);}catch{
    throw new NativeError('ProtocolMismatch','Reencoded MP4 did not have valid ffprobe metadata');
  }
  const video=record.streams?.find(s=>s.codec_type==='video'),
    audio=record.streams?.find(s=>s.codec_type==='audio');
  ensure(record.streams?.length===2 &&
    video?.codec_name==='h264'&&video.width===720&&video.height===1280&&
    video.avg_frame_rate==='30/1'&&Number(video.nb_frames)===frames &&
    audio?.codec_name==='aac'&&Number(audio.sample_rate)===48000 &&
    Math.abs(Number(record.format?.duration)-duration)<=0.08,
    'Derived portrait MP4 differs from the exact approved time, audio and pixel format',
    'Conflict');
  return {width:720,height:1280,frames,duration_seconds:Number(record.format.duration),
    audio_codec:'aac',video_codec:'h264',frame_rate:'30/1'};
}
function formatY(value){return JSON.stringify(value,null,2)+'\n';}
export async function makeVideoVariantZip(source,plan,sourceFile,outDir){
  const temp=mkdtempSync(join(outDir,'.lw-video-derive-'));
  try{
    const vertical=join(temp,'vertical.mp4');
    run('ffmpeg',[
      '-hide_banner','-nostdin','-v','error','-xerror',
      '-protocol_whitelist','file,pipe',
      '-i',sourceFile,
      '-map','0:v:0','-map','0:a:0',
      '-map_metadata','-1','-map_chapters','-1',
      '-filter:v',
      'scale=720:1280:force_original_aspect_ratio=decrease,'+
      'pad=720:1280:(ow-iw)/2:(oh-ih)/2:color=black,'+
      'setsar=1,fps=30,format=yuv420p',
      '-frames:v',String(plan.frames),
      '-c:v','libx264','-preset','medium','-crf','21',
      '-threads','1','-x264-params','scenecut=0:open-gop=0',
      '-c:a','copy',
      '-metadata','creation_time=2000-01-01T00:00:00Z',
      '-movflags','+faststart','-f','mp4','-y',vertical
    ],120000);
    const portraitProbe=checkVertical(vertical,plan.frames,plan.duration_seconds);
    const verticalBytes=readFileSync(vertical);
    ensure(verticalBytes.length>1000&&verticalBytes.length<=80*1024*1024,
      'Derived MP4 exceeds the bounded 80 MiB media output limit',
      'ResourceExhausted');
    const manifest={
      schema_version:'launchwright-video-variants-package/1',
      plan_sha256:plan.plan_sha256,
      media_plan_id:plan.media_plan_id,
      media_plan_digest:plan.media_plan_digest,
      landscape_variant_id:plan.landscape_variant_id,
      vertical_variant_id:plan.vertical_variant_id,
      master_output_id:plan.source_output_id,
      captions_candidate_id:plan.captions_candidate_id,
      captions_candidate_sha256:plan.captions_candidate_sha256,
      duration_seconds:plan.duration_seconds,
      frame_rate:'30/1',
      sources:{
        original_mp4_sha256:plan.source_mp4_sha256,
        native_vtt_sha256:plan.captions_sha256,
        operator_audio_rights_declaration:true
      },
      outputs:{
        'landscape-16x9.mp4':{sha256:sha(source.source_mp4),bytes:source.source_mp4.length,
          codec:'H264/AAC',dimensions:'1280x720'},
        'portrait-9x16.mp4':{sha256:sha(verticalBytes),bytes:verticalBytes.length,
          codec:'H264/AAC',dimensions:'720x1280'},
        'captions.vtt':{sha256:sha(source.vtt),bytes:source.vtt.length}
      },
      portrait_probe:portraitProbe,
      conversion:'spatial-aspect-contain-with-black-pad',
      source_timeline_recomposed:false,
      cropping_performed:false,alternate_voice_generated:false,
      captions_burned_in:false,external_network_access:false,
      derived_technical_state:'UNKNOWN',human_editorial_review_pending:true,
      operator_source_path_serialized:false,
      original_mp4_metadata_preserved:true,
      original_mp4_metadata_privacy_not_verified:true,
      customer_acceptance:false,semwright_platform_authority:false,
      public_release_performed:false
    };
    const documentation=Buffer.from(
      'LAUNCHWRIGHT / VIDEO VARIANTS / PRIVATE REVIEW\n'+
      'Original approved H.264/AAC landscape MP4, derived portrait MP4 '+
      'with original image fully contained (black letterbox), and frozen WebVTT captions.\n'+
      'No timeline recomposition, new narration, cropped UI, customer execution or Platform approval.\n'+
      'Both outputs need human captions/legibility and format review before use.\n','utf8');
    const entries=[
      {name:'landscape-16x9.mp4',bytes:source.source_mp4},
      {name:'portrait-9x16.mp4',bytes:verticalBytes},
      {name:'captions.vtt',bytes:source.vtt},
      {name:'manifest.json',bytes:Buffer.from(formatY(manifest))},
      {name:'README.txt',bytes:documentation}
    ];
    const zip=new JSZip();
    for(const item of entries)zip.file(item.name,item.bytes,{
      date:fixedDate,unixPermissions:'0600'
    });
    const bytes=Buffer.from(await zip.generateAsync({
      type:'nodebuffer',platform:'UNIX',compression:'DEFLATE',
      compressionOptions:{level:6}
    }));
    ensure(bytes.length<=160*1024*1024,
      'Video package exceeds 160 MiB','ResourceExhausted');
    const decoded=await JSZip.loadAsync(bytes,{checkCRC32:true});
    ensure(JSON.stringify(Object.keys(decoded.files).sort())===
      JSON.stringify(entries.map(x=>x.name).sort()),
      'Video package includes unplanned entries','ProtocolMismatch');
    for(const item of entries){
      const actual=await decoded.file(item.name).async('nodebuffer');
      ensure(actual.equals(item.bytes),'Video package byte readback differs','Conflict');
    }
    return{bytes,manifest,portraitProbe,zip_sha256:sha(bytes)};
  }finally{
    rmSync(temp,{recursive:true,force:true,maxRetries:5,retryDelay:50});
  }
}
