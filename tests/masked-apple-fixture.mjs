// SPDX-License-Identifier: AGPL-3.0-only
// Real owned synthetic 1179x2556 R55 masks -> Native derivative -> R44 Apple
// store pack -> R51 screenshot intent. NO real Apple account or customer app.
import { mkdtempSync,mkdirSync,chmodSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeOwnedStoreFixture } from './store-fixture.mjs';
import { preparePixelMask,applyPixelMask } from '../src/pixel-redaction.mjs';

export async function makeOwnedMaskedAppleFixture({screenshotCount=1}={}){
  const root=mkdtempSync(join(tmpdir(),'launchwright-r58-owned-'));
  let parent;
  try{
    parent=await makeOwnedStoreFixture(root,{
      platform:'apple-iphone-dynamic-island-medium',screenshotCount
    });
    const maskedDir=join(root,'masked'),outDir=join(root,'apple');
    for(const dir of [maskedDir,outDir]){
      mkdirSync(dir,{mode:0o700});
      if(process.platform!=='win32')chmodSync(dir,0o700);
    }
    const storeInput=structuredClone(parent.input),maskedSources=[];
    for(const [i,shot] of parent.plan.data.shots.entries()){
      const screenshot=storeInput.screenshots[i];
      const maskInput={
        parent_evidence_id:shot.capture_evidence_id,
        source_png_path:screenshot.png.path,
        source_png_sha256:screenshot.png.sha256,
        rights:storeInput.source_rights,
        rectangles:[
          {label:'operator_account',x:120+i*30,y:205,width:200,height:85},
          {label:'operator_profile',x:650,y:1450+i*20,width:150,height:70}
        ],
        acknowledge_source_rights:true,
        acknowledge_residual_privacy_unknown:true,
        acknowledge_masked_pixels:true
      };
      const maskPlan=preparePixelMask(parent.app,maskInput);
      const maskReceipt=await applyPixelMask(parent.app,maskPlan,maskInput,maskedDir,{
        confirm_plan_sha256:maskPlan.plan_sha256,
        confirm_source_png_sha256:maskPlan.source_png_sha256,
        acknowledge_private_file_write:true
      });
      maskedSources.push({mask_input:maskInput,mask_plan:maskPlan,
        mask_receipt:maskReceipt});
      screenshot.source_evidence_id=maskReceipt.derived_evidence_id;
      screenshot.png={
        path:join(maskedDir,maskReceipt.output_filename),
        sha256:maskReceipt.redacted_png_sha256
      };
    }
    const bundle={
      store_input:storeInput,masked_sources:maskedSources,
      acknowledge_mask_scope_only:true,
      acknowledge_private_apple_only:true
    };
    return{
      ...parent,root,maskedDir,outDir,storeInput,maskedSources,bundle,
      confirm:plan=>({
        confirm_masked_plan_sha256:plan.plan_sha256,
        confirm_store_plan_sha256:plan.store_plan_sha256,
        confirm_candidate_sha256:plan.candidate_sha256,
        acknowledge_private_export:true,
        acknowledge_remaining_privacy_unknown:true
      }),
      close(){
        try{parent.close();}finally{
          rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:50});
        }
      }
    };
  }catch(error){
    try{parent?.close();}finally{
      rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:50});
    }
    throw error;
  }
}
