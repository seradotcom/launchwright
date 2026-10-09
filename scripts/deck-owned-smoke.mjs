#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Owned disposable fixture: source-approved candidate -> actual editable PPTX
// and matching PDF, with operator-only private output and no external effects.
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { LaunchwrightApplication, execute } from '../src/application.mjs';
import { planDeckPdf, exportDeckPdf } from '../src/deck-pdf.mjs';

const argv=process.argv.slice(2);
if(argv.length!==2||argv[0]!=='--out-dir'){
  process.stderr.write('Usage: node scripts/deck-owned-smoke.mjs --out-dir /private/existing/0700/output\n');
  process.exit(2);
}
const dir=resolve(argv[1]),state=mkdtempSync(tmpdir()+'/launchwright-deck-owned-');
let app;
try{
  app=new LaunchwrightApplication(state,{initialize:true});
  const create=async(kind,data)=>(await execute(app,'entity.create',{kind,data})).entity;
  const product=await create('product',{
    name:'Owned synthetic release presentation',description:'Synthetic CI fixture only'
  });
  const release=await create('release',{
    product_id:product.id,name:'0.0-owned',build:'owned-synthetic-build-42',status:'draft'
  });
  const source=await create('source',{
    product_id:product.id,name:'Owned example editorial source',type:'web',
    locator:'http://127.0.0.1:4372/owned',build:release.data.build,
    coverage:'declared',approval:'approved',
    purpose:'Owned CI mock only; not a real customer product'
  });
  const target=await create('target',{
    release_id:release.id,name:'English editorial reviewers',
    ui_locale:'en-US',editorial_locale:'en-US',
    role:'reviewer',plan:'internal',region:'US',flags:{},
    viewport:{width:1440,height:900,scale_milli:1000}
  });
  const content=[
    '## What is actually included',
    '- A reviewed frozen editorial candidate with exact source bytes.',
    '- An editable presentation and a matching real PDF for human review.',
    '## Scope and claims',
    '- This sample is synthetic, not a customer product or public release.',
    '- Technical evidence remains UNKNOWN until independent approval.',
    '- The draft still requires separate publication authorization.'
  ].join('\n');
  const deliverable=await create('deliverable',{
    release_id:release.id,target_id:target.id,name:'Owned synthetic release deck',
    format:'markdown',content,claim_ids:[],source_ids:[source.id]
  });
  const artifact=(await execute(app,'deliverable.render',{id:deliverable.id})).entity;
  const candidate=(await execute(app,'candidate.freeze',{
    release_id:release.id,name:'Owned synthetic candidate',
    artifact_ids:[artifact.id],destination:'owned-deck-private-review',
    contract:{version:'r42',required_reviewers:1,require_claims_verified:false}
  })).entity;
  await execute(app,'candidate.review',{
    id:candidate.id,candidate_sha256:candidate.data.candidate_sha256,
    decision:'approve-editorial',comment:'Owned synthetic acceptance fixture only'
  });
  const plan=planDeckPdf(app,{candidate_id:candidate.id,artifact_id:artifact.id,
    acknowledge_draft_only:true,acknowledge_unverified:true});
  const receipt=await exportDeckPdf(app,plan,dir,{
    confirm_plan_sha256:plan.plan_sha256,
    confirm_candidate_sha256:plan.candidate_sha256,
    acknowledge_private_export:true
  });
  const report={
    schema_version:'launchwright-r42-owned-deck-smoke/1',
    synthetic_fixture:true,real_customer_acceptance:false,
    real_external_publication:false,source_authority:'LOCAL_OWNED_SYNTHETIC',
    editable_pptx_created:receipt.editable_pptx,real_pdf_created:receipt.pdf_rendered,
    page_count:receipt.page_count,output:receipt,
    native_sdk:'1.0.0',
    visual_human_review_pending:true,
    technical_state:'UNKNOWN',platform_authority:false
  };
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
}finally{
  try{app?.close();}finally{rmSync(state,{recursive:true,force:true,maxRetries:5,retryDelay:50});}
}
