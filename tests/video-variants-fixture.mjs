// SPDX-License-Identifier: AGPL-3.0-only
// Synthetic owned Video, captured Media context, AAC and frozen VTT fixture.
// Never customer footage, voice likeness or canonical Platform capture.
import { spawnSync } from 'node:child_process';
import { chmodSync,mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execute } from '../src/application.mjs';
import { baseline,captureInput,setup } from './helpers.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const interval=(start,end)=>({
  start:{num:String(start),den:'1'},end:{num:String(end),den:'1'}
});
export const FFMPEG_AVAILABLE=(()=>{
  const f=spawnSync('ffmpeg',['-hide_banner','-encoders'],{
    timeout:4000,encoding:'utf8',maxBuffer:1024*1024
  });
  const probe=spawnSync('ffprobe',['-version'],{timeout:3000,encoding:'utf8'});
  // On hosts without libx264, portable Node contract tests still run.
  // The mandatory owned Linux CI smoke does not skip actual encoding.
  return !f.error&&f.status===0&&!probe.error&&probe.status===0 &&
    (f.stdout??'').includes('libx264')&&(f.stdout??'').includes('aac');
})();;
export async function ownedVideoFixture(t,{duration=4,addReview=true}={}){
  const {app,root}=setup(t),b=await baseline(app);
  const source=(await execute(app,'entity.update',{
    id:b.source.id,expected:b.source.version,
    data:{...b.source.data,approval:'approved',
      purpose:'Owned R46 test fixture only'}
  })).entity;
  const scenario=await b.create('scenario',{
    release_id:b.release.id,name:'Owned AV source fixture',
    source_id:source.id,target_id:b.target.id,
    steps:[{action:'navigate',anchor:'root'},{action:'assert',anchor:'root'}],
    anchors:[{name:'root',role:'main',label:'Owned synthetic',expected_count:1}],
    readiness:'declared',version_label:'r46',reset_strategy:'isolated-context',effects:[]
  });
  const capture=(await execute(app,'capture.ingest',
    captureInput(b,source,scenario))).entity;
  const derivative=(await execute(app,'capture.ingest',
    captureInput(b,source,scenario,{
      name:'Sanitized media evidence for synthetic video',
      classification:'sanitized',
      provenance:{capture_class:'SANITIZED_DERIVATIVE',synthetic:true,
        parent_evidence_id:capture.id,
        transformations:[{kind:'REDACT',operation_ref:'owned-r46',
          semantic_effect:'preserves-observed-state'}]
      }
    }))).entity;
  const plan=(await execute(app,'media.plan',{
    release_id:b.release.id,target_id:b.target.id,
    scenario_id:scenario.id,name:'Owned horizontal to portrait review',
    backend:{profile:'motion-canvas',fidelity:'exact',losses:[],unsupported:[]},
    frame_rate:{num:30,den:1},duration:{num:String(duration),den:'1'},
    shots:[{
      id:'owned_state',name:'Synthetic source state',
      capture_evidence_id:capture.id,interactive_evidence_id:derivative.id,
      claim_ids:[],interval:interval(0,duration),
      purpose:'illustrative',transform_refs:['owned-fixture-state']
    }],
    assets:[],tracks:[],
    variants:[
      {id:'landscape',kind:'video',locale:'en-US',width:1280,height:720,
        safe_area_milli:{top:40,right:40,bottom:40,left:40},
        shot_ids:['owned_state'],track_ids:[]},
      {id:'portrait',kind:'video',locale:'en-US',width:720,height:1280,
        safe_area_milli:{top:40,right:40,bottom:40,left:40},
        shot_ids:['owned_state'],track_ids:[]},
      {id:'screens',kind:'screenshot-series',locale:'en-US',width:1280,height:720,
        safe_area_milli:{top:40,right:40,bottom:40,left:40},
        shot_ids:['owned_state'],track_ids:[]},
      {id:'demo',kind:'interactive-demo',locale:'en-US',width:1280,height:720,
        safe_area_milli:{top:40,right:40,bottom:40,left:40},
        shot_ids:['owned_state'],track_ids:[]}
    ],
    interactive_policy:{sanitized_only:true,productive_auth:false,
      active_source_scripts:false,external_links:[]}
  })).entity;
  const file=join(root,'source-owned.mp4');
  const r=spawnSync('ffmpeg',[
    '-hide_banner','-loglevel','error','-nostdin',
    '-f','lavfi','-i','testsrc2=size=1280x720:rate=30',
    '-f','lavfi','-i','sine=frequency=440:sample_rate=48000',
    '-t',String(duration),
    '-map','0:v:0','-map','1:a:0',
    '-c:v','libx264','-threads','1','-preset','ultrafast','-crf','30',
    '-pix_fmt','yuv420p',
    '-c:a','aac','-ar','48000','-ac','2','-b:a','96k',
    '-map_metadata','-1','-movflags','+faststart',
    '-y',file
  ],{timeout:120000,encoding:'utf8',maxBuffer:100000});
  if(r.status!==0)throw Error('Synthetic owned FFmpeg source generation failed: '+r.stderr);
  chmodSync(file,0o600);
  const videoSha=hash((await import('node:fs')).readFileSync(file));
  const master=(await execute(app,'media.output_record',{
    plan_id:plan.id,variant_id:'landscape',state:'SUCCEEDED',
    authority:'imported',provider:'owned-ffmpeg-fixture',provider_version:'test',
    artifact_sha256:videoSha,mime:'video/mp4',
    duration:{num:String(duration),den:'1'},
    observed_at:'2026-10-09T18:00:00.000Z',
    reported_verification:'UNKNOWN'
  })).entity;
  if(addReview)await execute(app,'media.review_record',{
    output_id:master.id,artifact_sha256:videoSha,
    decision:'approve-editorial',comment:'Owned synthetic audio/video fixtures only'
  });
  const cues=[
    {start_ms:500,end_ms:1300,text:'Owned synthetic video state'},
    {start_ms:1800,end_ms:Math.min(duration*1000-200,2900),text:'Format review is not publication'}
  ];
  const captionDeliverable=(await execute(app,'entity.update',{
    id:b.deliverable.id,expected:b.deliverable.version,
    data:{...b.deliverable.data,name:'Owned VTT captions',
      format:'vtt',captions:cues}
  })).entity;
  const vtt=(await execute(app,'deliverable.render',{id:captionDeliverable.id})).entity;
  const candidate=(await execute(app,'candidate.freeze',{
    release_id:b.release.id,name:'Synthetic approved WebVTT',
    artifact_ids:[vtt.id],destination:'private-caption-review',
    contract:{version:'R46',required_reviewers:1,require_claims_verified:false}
  })).entity;
  await execute(app,'candidate.review',{
    id:candidate.id,candidate_sha256:candidate.data.candidate_sha256,
    decision:'approve-editorial',comment:'Reviewed exactly this owned WebVTT'
  });
  const input={
    media_plan_id:plan.id,media_output_id:master.id,
    landscape_variant_id:'landscape',vertical_variant_id:'portrait',
    source_mp4_path:file,source_mp4_sha256:videoSha,
    caption_candidate_id:candidate.id,caption_artifact_id:vtt.id,
    acknowledge_audio_rights:true,
    acknowledge_technical_unknown:true
  };
  const outDir=join(root,'private-variants');
  mkdirSync(outDir,{mode:0o700});if(process.platform!=='win32')chmodSync(outDir,0o700);
  const approve=plan=>({
    confirm_plan_sha256:plan.plan_sha256,
    confirm_source_mp4_sha256:plan.source_mp4_sha256,
    acknowledge_private_export:true
  });
  return{app,root,b,source,scenario,plan,master,vtt,candidate,file,videoSha,
    input,outDir,approve,duration};
}
