// SPDX-License-Identifier: AGPL-3.0-only
// R64 genuine Native SDK synthetic release with 3 docs + 1 separate deck
// artifact all frozen in ONE candidate, no customer/product capture claims.
import { mkdtempSync,mkdirSync,chmodSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execute } from '../src/application.mjs';
import { makeOwnedStaticDocsFixture } from './static-docs-fixture.mjs';
import { planStaticDocs,exportStaticDocs } from '../src/static-docs.mjs';
import { planDeckPdf,exportDeckPdf } from '../src/deck-pdf.mjs';
import { planReleaseReviewKit,exportReleaseReviewKit } from '../src/release-review-kit.mjs';

export async function makeOwnedReviewKitFixture(root=mkdtempSync(join(tmpdir(),'launchwright-r64-owned-'))){
  const f=await makeOwnedStaticDocsFixture({root});
  const deckContent=[
    '## What is included',
    '- An exact frozen editorial candidate is used for every exported material.',
    '- PowerPoint and PDF contain the same approved source paragraphs.',
    '## What is not verified',
    '- Product behavior remains UNKNOWN, and these are private sample outputs.',
    '- No customer publication, rights approval, or Platform job is inferred.'
  ].join('\n');
  const deliverable=(await execute(f.app,'entity.create',{kind:'deliverable',data:{
    release_id:f.release.id,target_id:f.target.id,
    name:'Owned release reviewer presentation',
    format:'markdown',content:deckContent,claim_ids:[],
    source_ids:[f.source.id]
  }})).entity;
  const deckArtifact=(await execute(f.app,'deliverable.render',{id:deliverable.id})).entity;
  const candidate=(await execute(f.app,'candidate.freeze',{
    release_id:f.release.id,name:'One candidate / multi-format review',
    artifact_ids:[...f.artifacts.map(a=>a.id),deckArtifact.id],
    destination:'owned-private-release-kit',
    contract:{version:'r64',required_reviewers:1,require_claims_verified:false}
  })).entity;
  await execute(f.app,'candidate.review',{
    id:candidate.id,candidate_sha256:candidate.data.candidate_sha256,
    decision:'approve-editorial',
    comment:'Owned synthetic review of exact four source artifacts'
  });
  const exportFolder=(name)=>{
    const folder=join(root,name);mkdirSync(folder,{mode:0o700});
    if(process.platform!=='win32')chmodSync(folder,0o700);
    return folder;
  };
  const deckFolder=exportFolder('deck-private'),
    kitFolder=exportFolder('kit-private');
  const docsInput={...f.input,candidate_id:candidate.id};
  const docPlan=await planStaticDocs(f.app,docsInput);
  const docReceipt=await exportStaticDocs(f.app,docPlan,f.output,{
    confirm_plan_sha256:docPlan.plan_sha256,
    confirm_candidate_sha256:candidate.data.candidate_sha256,
    acknowledge_private_export:true
  });
  const deckPlan=planDeckPdf(f.app,{
    candidate_id:candidate.id,artifact_id:deckArtifact.id,
    acknowledge_draft_only:true,acknowledge_unverified:true
  });
  const deckReceipt=await exportDeckPdf(f.app,deckPlan,deckFolder,{
    confirm_plan_sha256:deckPlan.plan_sha256,
    confirm_candidate_sha256:candidate.data.candidate_sha256,
    acknowledge_private_export:true
  });
  const kitInput={
    docs:{plan:docPlan,directory:f.output},
    deck:{plan:deckPlan,directory:deckFolder},
    acknowledge_rights:true,acknowledge_private_only:true
  };
  const approve=p=>({
    confirm_plan_sha256:p.plan_sha256,
    confirm_candidate_sha256:p.candidate_sha256,
    acknowledge_export:true
  });
  return{...f,root,candidate,deckArtifact,
    deckPlan,deckReceipt,docPlan,docReceipt,
    kitFolder,deckFolder,kitInput,approve,
    async exportKit(){
      const plan=await planReleaseReviewKit(f.app,kitInput);
      return{plan,receipt:await exportReleaseReviewKit(f.app,plan,
        kitInput,kitFolder,approve(plan))}
    },
    close(){
      try{f.app.close();}finally{rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:50});}
    }
  };
}
