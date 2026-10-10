// SPDX-License-Identifier: AGPL-3.0-only
// Real owned R55 masks -> R44 Google Play package, synthetic pixels only.
// The capture Evidence is an owned fixture declaration, NOT verified device
// capture or independent full-image privacy approval.
import { mkdtempSync,mkdirSync,chmodSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeOwnedStoreFixture } from './store-fixture.mjs';
import { preparePixelMask,applyPixelMask } from '../src/pixel-redaction.mjs';

export async function makeOwnedMaskedStoreFixture({
  screenshotCount=2,withGraphics=true
}={}){
  const root=mkdtempSync(join(tmpdir(),'launchwright-r56-masked-store-'));
  let x;
  try{
    x=await makeOwnedStoreFixture(root,{platform:'google-play-phone-portrait',
      screenshotCount});
    const maskedDir=join(root,'masked'),storeDir=join(root,'store-private');
    for(const dir of [maskedDir,storeDir]){
      mkdirSync(dir,{mode:0o700});
      if(process.platform!=='win32')chmodSync(dir,0o700);
    }
    const maskedSources=[];
    const storeInput=structuredClone(x.input);
    for(const [index,screenshot] of x.input.screenshots.entries()){
      const maskInput={
        parent_evidence_id:x.plan.data.shots[index].capture_evidence_id,
        source_png_path:screenshot.png.path,
        source_png_sha256:screenshot.png.sha256,
        rights:'owned',
        rectangles:[
          {label:'operator-selected-account',x:120+index*30,y:205,width:200,height:85},
          {label:'operator-selected-profile',x:650,y:1070+index*20,width:120,height:70}
        ],
        acknowledge_source_rights:true,
        acknowledge_residual_privacy_unknown:true,
        acknowledge_masked_pixels:true
      };
      const maskPlan=preparePixelMask(x.app,maskInput);
      const maskReceipt=await applyPixelMask(x.app,maskPlan,maskInput,maskedDir,{
        confirm_plan_sha256:maskPlan.plan_sha256,
        confirm_source_png_sha256:maskPlan.source_png_sha256,
        acknowledge_private_file_write:true
      });
      maskedSources.push({
        mask_input:maskInput,mask_plan:maskPlan,mask_receipt:maskReceipt
      });
      storeInput.screenshots[index].source_evidence_id=maskReceipt.derived_evidence_id;
      storeInput.screenshots[index].png={
        path:join(maskedDir,maskReceipt.output_filename),
        sha256:maskReceipt.redacted_png_sha256
      };
    }
    if(!withGraphics)storeInput.graphics={icon:null,feature:null};
    const bundle={
      store_input:storeInput,
      masked_sources:maskedSources,
      acknowledge_mask_scope_only:true,
      acknowledge_private_store_only:true
    };
    return{
      ...x,root,maskedDir,storeDir,storeInput,maskedSources,bundle,
      confirm:plan=>({
        confirm_handoff_sha256:plan.plan_sha256,
        confirm_store_plan_sha256:plan.store_plan_sha256,
        confirm_candidate_sha256:plan.candidate_sha256,
        acknowledge_private_export:true,
        acknowledge_remaining_privacy_unknown:true
      }),
      close:()=>{
        try{x.close();}finally{
          rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:50});
        }
      }
    };
  }catch(err){
    try{x?.close();}finally{
      rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:50});
    }
    throw err;
  }
}
