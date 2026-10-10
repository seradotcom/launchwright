#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Owned synthetic R57 E2E: R55 masked pixels and Native evidence to actual
// PPTX/PDF image slides. No external customer pixels or account credentials.
import {mkdtempSync,mkdirSync,chmodSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {execute} from '../src/application.mjs';
import {makeOwnedInteractiveFixture} from '../tests/interactive-fixture.mjs';
import {preparePixelMask,applyPixelMask} from '../src/pixel-redaction.mjs';
import {prepareMaskedDeck,exportMaskedDeck} from '../src/masked-deck.mjs';

const [option,out]=process.argv.slice(2);
if(option!=='--out-dir'||!out)throw Error('Usage: --out-dir ABS_PRIVATE_DIRECTORY');
const root=mkdtempSync(join(tmpdir(),'launchwright-r57-owned-'));
let fixture;
try{
  const destination=resolve(out);
  fixture=await makeOwnedInteractiveFixture(root,{framesCount:2,width:640,height:360});
  const maskOut=join(root,'masked');mkdirSync(maskOut,{mode:0o700});
  if(process.platform!=='win32')chmodSync(maskOut,0o700);
  const content=[
    '## Product screen one',
    '- The screenshot is tied to a Native source and approved pixel-mask receipt.',
    '- This source is synthetic and requires independent privacy review.',
    '## Product screen two',
    '- The second slide preserves exactly the separately masked PNG pixels.',
    '- Both documents are editorial drafts and do not prove product behavior.'
  ].join('\n');
  const d=(await execute(fixture.app,'entity.update',{
    id:fixture.b.deliverable.id,expected:fixture.b.deliverable.version,
    data:{...fixture.b.deliverable.data,content}
  })).entity;
  const a=(await execute(fixture.app,'deliverable.render',{id:d.id})).entity;
  const c=(await execute(fixture.app,'candidate.freeze',{
    release_id:fixture.b.release.id,name:'R57 owned synthetic masked deck',
    artifact_ids:[a.id],destination:'local-private-masked-deck',
    contract:{version:'r57-ci',required_reviewers:1,require_claims_verified:false}
  })).entity;
  await execute(fixture.app,'candidate.review',{
    id:c.id,candidate_sha256:c.data.candidate_sha256,
    decision:'approve-editorial',comment:'Owned synthetic fixture only'
  });
  const screenshots=[];
  for(let i=0;i<2;i++){
    const frame=fixture.frames[i];
    const input={
      parent_evidence_id:fixture.plan.data.shots[i].capture_evidence_id,
      source_png_path:frame.png_path,source_png_sha256:frame.png_sha256,
      rights:'owned',rectangles:[
        {label:'protected-account',x:180,y:92,width:72,height:32},
        {label:'protected-profile',x:280,y:218,width:54,height:25}
      ],acknowledge_source_rights:true,
      acknowledge_residual_privacy_unknown:true,acknowledge_masked_pixels:true
    };
    const mask=preparePixelMask(fixture.app,input);
    const receipt=await applyPixelMask(fixture.app,mask,input,maskOut,{
      confirm_plan_sha256:mask.plan_sha256,
      confirm_source_png_sha256:mask.source_png_sha256,
      acknowledge_private_file_write:true
    });
    screenshots.push({mask_input:input,mask_plan:mask,mask_receipt:receipt,
      masked_png_path:join(maskOut,receipt.output_filename)});
  }
  const request={
    deck:{candidate_id:c.id,artifact_id:a.id,
      acknowledge_draft_only:true,acknowledge_unverified:true},
    screenshots,acknowledge_mask_scope_only:true,
    acknowledge_private_deck_only:true
  };
  const plan=prepareMaskedDeck(fixture.app,request);
  const receipt=await exportMaskedDeck(fixture.app,plan,request,destination,{
    confirm_plan_sha256:plan.plan_sha256,
    confirm_candidate_sha256:plan.candidate_sha256,
    acknowledge_private_export:true
  });
  console.log(JSON.stringify({
    schema_version:'launchwright-owned-masked-deck-acceptance/1',
    synthetic_fixture:true,native_sdk:'1.0.0',
    candidate_sha256:plan.candidate_sha256,masked_deck_plan_sha256:plan.plan_sha256,
    exact_native_derivatives:plan.screenshots.map(v=>v.derived_evidence_id),
    screenshots:plan.screenshot_count,pages:receipt.pages,
    documents:receipt.documents,
    technical_state:'UNKNOWN',pixel_privacy_certified:false,
    external_service_called:false,source_product_executed:false,
    platform_authority:false,customer_acceptance:false,
    human_visual_acceptance_pending:true
  },null,2));
}finally{
  try{fixture?.close();}finally{rmSync(root,{recursive:true,force:true,maxRetries:4,retryDelay:50});}
}
