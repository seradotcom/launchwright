// SPDX-License-Identifier: AGPL-3.0-only
// Genuine owned Native R55 -> R59 -> R61 demo combined with R45/R42 same release.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,chmodSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import JSZip from 'jszip';
import {execute} from '../src/application.mjs';
import {makeOwnedMaskedDemoFixture} from './masked-demo-fixture.mjs';
import {planMaskedInteractiveDemo,exportMaskedInteractiveDemo} from '../src/masked-interactive-demo.mjs';
import {planOfflineHotspots,exportOfflineHotspots} from '../src/offline-hotspots.mjs';
import {planStaticDocs,exportStaticDocs} from '../src/static-docs.mjs';
import {planDeckPdf,exportDeckPdf} from '../src/deck-pdf.mjs';
import {planReleaseReviewKit,exportReleaseReviewKit} from '../src/release-review-kit.mjs';

const folder=(root,name)=>{
  const path=join(root,name);mkdirSync(path,{mode:0o700});
  if(process.platform!=='win32')chmodSync(path,0o700);
  return path;
};
test('R64 genuine optional R61 CSS demo uses R55 Native-masked Media and the same release as docs/deck',async t=>{
  const root=mkdtempSync(join(tmpdir(),'launchwright-r64-masked-'));
  const f=await makeOwnedMaskedDemoFixture(root);
  t.after(()=>{try{f.close();}catch{}rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:50});});
  const r59=planMaskedInteractiveDemo(f.app,f.request);
  const masked=await exportMaskedInteractiveDemo(f.app,r59,f.request,
    f.outputDir,f.confirmation(r59));
  const shots=r59.masks.map(x=>x.shot_id);
  const args={
    masked_plan:r59,masked_request:f.request,source_dir:f.outputDir,
    links:[
      {from_shot_id:shots[0],to_shot_id:shots[1],label:'Next static state',
        x:420,y:135,width:90,height:70},
      {from_shot_id:shots[1],to_shot_id:shots[0],label:'Previous static state',
        x:420,y:135,width:90,height:70}
    ],
    acknowledge_mask_scope_only:true,acknowledge_private_only:true
  };
  const r61=await planOfflineHotspots(f.app,args);
  const demoFolder=folder(root,'demo-package');
  const demoReceipt=await exportOfflineHotspots(f.app,r61,args,demoFolder,{
    confirm_plan_sha256:r61.plan_sha256,
    confirm_r59_bundle_sha256:r61.r59_bundle_sha256,
    acknowledge_private_export:true,
    acknowledge_privacy_outside_masks_unknown:true
  });
  assert.equal(demoReceipt.r59_media_output_id,masked.media_output_id);
  const create=async(kind,data)=>(await execute(f.app,'entity.create',{kind,data})).entity;
  const pages=[
    {slug:'start',name:'Private starting guide',
      content:'## Start here\nRead the [Guide](./guide.html) for synthetic details.\n~~~bash\nnpm run start\n~~~'},
    {slug:'guide',name:'Owned reviewer guide',
      content:'## Reviewer information\nReturn to [Start here](./start.html) to see the release.\n~~~text\nUNKNOWN\n~~~'}
  ];
  const artifacts=[],specs=[];
  for(const page of pages){
    const deliverable=await create('deliverable',{
      release_id:f.b.release.id,target_id:f.b.target.id,name:page.name,
      format:'markdown',content:page.content,claim_ids:[],source_ids:[f.source.id]
    });
    const artifact=(await execute(f.app,'deliverable.render',{id:deliverable.id})).entity;
    artifacts.push(artifact);specs.push({slug:page.slug,artifact_id:artifact.id});
  }
  const deckDeliverable=await create('deliverable',{
    release_id:f.b.release.id,target_id:f.b.target.id,
    name:'Synthetic masked demo release deck',format:'markdown',
    content:'## Review sources\n- Native media screenshots are masked in selected rectangles.\n- Source files require human review before external sharing.',
    claim_ids:[],source_ids:[f.source.id]
  });
  const deckArtifact=(await execute(f.app,'deliverable.render',{id:deckDeliverable.id})).entity;
  const candidate=(await execute(f.app,'candidate.freeze',{
    release_id:f.b.release.id,name:'R64 masked cross-output release',
    artifact_ids:[...artifacts.map(a=>a.id),deckArtifact.id],
    destination:'owned-private-review',
    contract:{version:'r64-masked',required_reviewers:1,require_claims_verified:false}
  })).entity;
  await execute(f.app,'candidate.review',{
    id:candidate.id,candidate_sha256:candidate.data.candidate_sha256,
    decision:'approve-editorial',comment:'Owned synthetic masked demo/docs/deck review'
  });
  const docsPlan=await planStaticDocs(f.app,{
    candidate_id:candidate.id,pages:specs,
    acknowledge_draft_only:true,acknowledge_unverified:true,
    acknowledge_source_rights:true
  });
  const docsFolder=folder(root,'docs-package');
  await exportStaticDocs(f.app,docsPlan,docsFolder,{
    confirm_plan_sha256:docsPlan.plan_sha256,
    confirm_candidate_sha256:candidate.data.candidate_sha256,
    acknowledge_private_export:true
  });
  const deckPlan=planDeckPdf(f.app,{
    candidate_id:candidate.id,artifact_id:deckArtifact.id,
    acknowledge_draft_only:true,acknowledge_unverified:true
  });
  const deckFolder=folder(root,'deck-package');
  await exportDeckPdf(f.app,deckPlan,deckFolder,{
    confirm_plan_sha256:deckPlan.plan_sha256,
    confirm_candidate_sha256:candidate.data.candidate_sha256,
    acknowledge_private_export:true
  });
  const input={
    docs:{plan:docsPlan,directory:docsFolder},
    deck:{plan:deckPlan,directory:deckFolder},
    demo:{plan:r61,directory:demoFolder},
    acknowledge_rights:true,acknowledge_private_only:true
  };
  const plan=await planReleaseReviewKit(f.app,input);
  assert.deepEqual(plan.outputs,[
    'offline-docs','editable-pptx','real-pdf','masked-offline-demo'
  ]);
  assert.equal(plan.release_id,f.b.release.id);
  assert.equal(plan.demo_zip_sha256,demoReceipt.hotspot_zip_sha256);
  assert.equal(plan.technical_state,'UNKNOWN');
  assert.equal(plan.pixel_privacy_independently_verified,false);
  const kitFolder=folder(root,'review-package');
  const result=await exportReleaseReviewKit(f.app,plan,input,kitFolder,{
    confirm_plan_sha256:plan.plan_sha256,
    confirm_candidate_sha256:plan.candidate_sha256,
    acknowledge_export:true
  });
  const archive=await JSZip.loadAsync(readFileSync(join(kitFolder,result.filename)));
  assert.ok(archive.file('demo/index.html'));
  assert.ok(archive.file('docs/index.html'));
  assert.ok(archive.file('deck/release-deck.pdf'));
  assert.ok(archive.file('deck/release-deck.pptx'));
  const index=await archive.file('index.html').async('string');
  assert.ok(index.includes('demo/index.html'));
  const demo=await archive.file('demo/index.html').async('string');
  assert.ok(!/<script\b|<iframe\b/u.test(demo));
  assert.equal(result.published,false);
  assert.equal(result.platform_authority,false);
  assert.equal(f.app.list('media_output').length,1,
    'Review kit does not mint independent false runtime Media receipts');
});
