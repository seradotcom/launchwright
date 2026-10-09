// SPDX-License-Identifier: AGPL-3.0-only
// Owned synthetic exact Native SDK fixture for R45. No customer sources.
import { mkdirSync, mkdtempSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LaunchwrightApplication, execute } from '../src/application.mjs';

const sample=[
  {slug:'start',title:'Getting started',content:[
    '## Why this snapshot exists',
    'This approved editorial draft links to the [API guide](./api.html) and stays offline.',
    '## Command example',
    '~~~bash',
    'npm run start',
    '~~~',
    '## Work with your release',
    '- Pin the build identity before creating any candidate.',
    '- Collect evidence without claiming unverified product behavior.'
  ].join('\n')},
  {slug:'api',title:'API guide',content:[
    '## Read-only calls',
    'The [Getting started](./start.html) page introduces the local workflow.',
    '## JSON response example',
    '~~~json',
    '{"status":"local-draft","published":false}',
    '~~~',
    '## Review limits',
    '- API replies do not establish cross-tenant Platform authority.',
    '- All publication requires independent permission.'
  ].join('\n')},
  {slug:'review',title:'Editorial and source review',content:[
    '## Before sharing the docs',
    'Return to the [API guide](./api.html) and inspect all source receipts.',
    '## What stays unknown',
    'Content and code samples do not certify a running customer product.',
    '~~~text',
    'TECHNICAL UNKNOWN - human review required',
    '~~~'
  ].join('\n')}
];
export async function makeOwnedStaticDocsFixture({
  app=null,root=null,releaseName='1.0',build='build-A',product=null,
  pages=sample,locale='en-US',review=true
}={}){
  const own=!app;
  const workspace=root??mkdtempSync(join(tmpdir(),'launchwright-static-docs-'));
  if(!app)app=new LaunchwrightApplication(workspace,{initialize:true});
  const create=async(kind,data)=>(await execute(app,'entity.create',{kind,data})).entity;
  product=product??await create('product',{
    name:'Owned synthetic documentation fixture',description:'Local CI source only'
  });
  const release=await create('release',{
    product_id:product.id,name:releaseName,build,status:'draft'
  });
  const source=await create('source',{
    product_id:product.id,name:'Owned documentation '+releaseName,
    type:'web',locator:'http://127.0.0.1:4320/owned-docs/'+releaseName,
    build,coverage:'declared',purpose:'Owner-approved synthetic text fixture',
    approval:'approved'
  });
  const target=await create('target',{
    release_id:release.id,name:'English documentation '+releaseName,
    ui_locale:locale,editorial_locale:locale,
    role:'viewer',plan:'local',region:'MX',flags:{},
    viewport:{width:1280,height:800,scale_milli:1000}
  });
  const artifacts=[],deliverables=[],pageSpecs=[];
  for(const page of pages){
    const deliverable=await create('deliverable',{
      release_id:release.id,target_id:target.id,
      name:page.title,format:'markdown',
      content:page.content,claim_ids:[],source_ids:[source.id]
    });
    const artifact=(await execute(app,'deliverable.render',{id:deliverable.id})).entity;
    deliverables.push(deliverable);artifacts.push(artifact);
    pageSpecs.push({slug:page.slug,artifact_id:artifact.id});
  }
  const candidate=(await execute(app,'candidate.freeze',{
    release_id:release.id,name:releaseName+' exact docs bundle',
    artifact_ids:artifacts.map(a=>a.id),destination:'private-docs',
    contract:{version:'r45',required_reviewers:1,require_claims_verified:false}
  })).entity;
  if(review){
    await execute(app,'candidate.review',{
      id:candidate.id,candidate_sha256:candidate.data.candidate_sha256,
      decision:'approve-editorial',
      comment:'Synthetic documentation review, no customer acceptance'
    });
  }
  const output=join(workspace,'docs-output-'+releaseName.replaceAll('.','_'));
  mkdirSync(output,{mode:0o700});
  if(process.platform!=='win32')chmodSync(output,0o700);
  const input={
    candidate_id:candidate.id,pages:pageSpecs,
    acknowledge_draft_only:true,acknowledge_unverified:true,
    acknowledge_source_rights:true
  };
  return{
    app,root:workspace,own,product,release,source,target,deliverables,
    artifacts,candidate,output,input,
    approve:plan=>({
      confirm_plan_sha256:plan.plan_sha256,
      confirm_candidate_sha256:plan.candidate_sha256,
      acknowledge_private_export:true
    })
  };
}
