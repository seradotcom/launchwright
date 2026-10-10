#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// R54 owned two-release fixture for real review ZIP and browser acceptance.
// No customer source, live Platform, account or external publication.
import { mkdtempSync,rmSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import JSZip from 'jszip';
import { LaunchwrightApplication,execute } from '../src/application.mjs';
import { planReleaseContinuity,exportReleaseContinuity } from '../src/release-continuity.mjs';

const [flag,out]=process.argv.slice(2);
if(flag!=='--out-dir'||!out){
  process.stderr.write('Usage: node scripts/continuity-owned-smoke.mjs --out-dir /absolute/0700/existing\n');
  process.exit(2);
}
const state=mkdtempSync(join(tmpdir(),'launchwright-r54-owned-'));
let app;
try{
  app=new LaunchwrightApplication(state,{initialize:true});
  const create=async(kind,data)=>(await execute(app,'entity.create',{kind,data})).entity;
  const product=await create('product',{name:'Synthetic continuity product',
    description:'Internal synthetic fixture, no customer account'});
  const version=async(label,build)=>{
    const release=await create('release',{
      product_id:product.id,name:label,build,status:'draft'
    });
    const source=await create('source',{
      product_id:product.id,name:'Owned '+build+' declared source',type:'web',
      locator:'http://127.0.0.1:4320/'+build,build,coverage:'declared'
    });
    const target=await create('target',{
      release_id:release.id,name:'English basic',
      ui_locale:'en-US',editorial_locale:'en-US',role:'viewer',plan:'basic',
      region:'MX',flags:{advanced_export:false},
      viewport:{width:1440,height:900,scale_milli:1000}
    });
    return{release,source,target};
  };
  const before=await version('1.0 Synthetic','synthetic-build-A');
  const after=await version('1.1 Synthetic','synthetic-build-B');
  const syntheticClaim=await create('claim',{
    release_id:after.release.id,name:'Owned API guide availability',
    target_id:after.target.id,text:'A synthetic API guide is included in this draft',
    category:'feature',evidence_ids:[]
  });
  const artifact=async(state,name,text,claimIds=[])=>{
    const doc=await create('deliverable',{
      release_id:state.release.id,name,target_id:state.target.id,
      format:'markdown',content:text,claim_ids:claimIds,source_ids:[state.source.id]
    });
    return(await execute(app,'deliverable.render',{id:doc.id})).entity;
  };
  const common='Reviewed editorial note: export access requires operator consent.';
  const a=[
    await artifact(before,'Release notes',common),
    await artifact(before,'Migration notice','Previous version contains a legacy migration note.')
  ];
  const b=[
    await artifact(after,'Release notes',common),
    await artifact(after,'New API guide','The updated synthetic release includes an API guide draft.',[syntheticClaim.id])
  ];
  const freeze=async(state,artifacts)=>{
    const candidate=(await execute(app,'candidate.freeze',{
      release_id:state.release.id,name:'Owned '+state.release.data.name+' review',
      artifact_ids:artifacts.map(x=>x.id),destination:'local-release-continuity',
      contract:{version:'r54-owned',required_reviewers:1,require_claims_verified:false}
    })).entity;
    await execute(app,'candidate.review',{id:candidate.id,
      candidate_sha256:candidate.data.candidate_sha256,
      decision:'approve-editorial',comment:'Approve exact owned synthetic fixture candidate'
    });
    return candidate;
  };
  const first=await freeze(before,a),second=await freeze(after,b);
  const input={
    before_release_id:before.release.id,after_release_id:after.release.id,
    before_candidate_id:first.id,after_candidate_id:second.id,
    acknowledge_private_only:true,acknowledge_incomplete_coverage:true
  };
  const plan=planReleaseContinuity(app,input);
  const receipt=await exportReleaseContinuity(app,plan,resolve(out),{
    confirm_plan_sha256:plan.plan_sha256,
    confirm_before_candidate_sha256:plan.before_candidate_sha256,
    confirm_after_candidate_sha256:plan.after_candidate_sha256,
    acknowledge_private_export:true
  });
  const fs=await import('node:fs');
  const zip=await JSZip.loadAsync(
    fs.readFileSync(join(resolve(out),receipt.filename)),{checkCRC32:true});
  const html=await zip.file('index.html').async('nodebuffer');
  writeFileSync(join(resolve(out),'preview.html'),html,{flag:'wx',mode:0o600});
  const report={
    schema_version:'launchwright-r54-owned-continuity-smoke/1',
    original_product:'OWNED_SYNTHETIC_ONLY',before_release:'1.0 Synthetic',
    after_release:'1.1 Synthetic',exact_source_releases:true,
    expected_changes:{changed:1,added:1,removed:1,unchanged:0},
    private_report:receipt,synthetic_data_only:true,
    external_publication:false,platform_authority:false,
    real_customer_acceptance:false,canonical_host_acceptance:false
  };
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
}finally{
  try{app?.close();}finally{
    rmSync(state,{recursive:true,force:true,maxRetries:5,retryDelay:50});
  }
}
