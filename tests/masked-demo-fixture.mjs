// SPDX-License-Identifier: AGPL-3.0-only
// R59 owned synthetic R43 Media/Native screenshots transformed by actual
// R55 opaque masks. Not a customer device, canonical execution or privacy QA.
import { mkdirSync,chmodSync } from 'node:fs';
import { join } from 'node:path';
import { execute } from '../src/application.mjs';
import { makeOwnedInteractiveFixture } from './interactive-fixture.mjs';
import { preparePixelMask, applyPixelMask } from '../src/pixel-redaction.mjs';

const privateDir=(root,name)=>{
  const path=join(root,name);
  mkdirSync(path,{recursive:true,mode:0o700});
  if(process.platform!=='win32')chmodSync(path,0o700);
  return path;
};
export async function makeOwnedMaskedDemoFixture(root,{
  maliciousLabel=false,framesCount=2,width=640,height=360
}={}){
  const f=await makeOwnedInteractiveFixture(root,{maliciousLabel,framesCount,width,height});
  const maskDir=privateDir(root,'mask-results'),
    outputDir=privateDir(root,'r59-output');
  const masked_sources=[],frames=[];
  for(let i=0;i<framesCount;i++){
    const original=f.frames[i],
      shot=f.plan.data.shots[i];
    const mask_input={
      parent_evidence_id:shot.capture_evidence_id,
      source_png_path:original.png_path,
      source_png_sha256:original.png_sha256,
      rights:'owned',
      rectangles:[
        {label:'account-panel',x:185,y:92,width:60,height:25},
        {label:'customer-value',x:283,y:221,width:48,height:28}
      ],
      acknowledge_source_rights:true,
      acknowledge_residual_privacy_unknown:true,
      acknowledge_masked_pixels:true
    };
    const mask_plan=preparePixelMask(f.app,mask_input);
    const mask_receipt=await applyPixelMask(f.app,mask_plan,mask_input,maskDir,{
      confirm_plan_sha256:mask_plan.plan_sha256,
      confirm_source_png_sha256:mask_plan.source_png_sha256,
      acknowledge_private_file_write:true
    });
    const masked_png_path=join(maskDir,mask_receipt.output_filename);
    masked_sources.push({
      mask_input,mask_plan,mask_receipt,masked_png_path
    });
    frames.push({
      ...original,
      png_path:masked_png_path,
      png_sha256:mask_plan.masked_png_sha256,
      source_evidence_id:mask_receipt.derived_evidence_id
    });
  }
  // The R43 Media plan itself must pin the NEW exact R55 Native derivative
  // rather than any old synthetic demonstration of sanitization.
  const old=f.plan.data;
  const reviewedPlan={
    release_id:old.release_id,target_id:old.target_id,
    scenario_id:old.scenario_id,name:old.name,
    backend:old.backend,frame_rate:old.frame_rate,
    duration:old.duration,
    shots:old.shots.map((s,i)=>({
      ...s,interactive_evidence_id:masked_sources[i].mask_receipt.derived_evidence_id
    })),
    assets:old.assets,tracks:old.tracks,
    variants:old.variants,interactive_policy:old.interactive_policy
  };
  const revision=(await execute(f.app,'media.revise',{
    id:f.plan.id,expected:f.plan.version,plan:reviewedPlan,
    reason:'R59 owned fixture uses current exact R55 Native masked derivatives'
  })).entity;
  const demo_input={
    ...f.input,media_plan_id:revision.id,frames
  };
  const request={
    demo_input,masked_sources,
    acknowledge_mask_scope_only:true,
    acknowledge_private_only:true
  };
  const confirmation=plan=>({
    confirm_plan_sha256:plan.plan_sha256,
    confirm_media_plan_digest:plan.media_plan_digest,
    acknowledge_private_export:true,
    acknowledge_privacy_outside_masks_unknown:true
  });
  return{...f,plan:revision,maskDir,outputDir,request,masked_sources,
    confirmation};
}
