// SPDX-License-Identifier: AGPL-3.0-only
// R45: approved immutable Markdown source -> version-bound offline docs.
import { createHash } from 'node:crypto';
import { closeSync,existsSync,lstatSync,openSync,readFileSync,unlinkSync,writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { requireCondition as ensure, validateValue, NativeError } from '@semwright/native-sdk';
import { digest } from './base.mjs';
import { parseStaticDocsMarkdown, renderStaticDocs } from './static-docs-view.mjs';

export const STATIC_DOCS_SCHEMA='launchwright-static-docs-intent/1';
const sha=x=>createHash('sha256').update(x).digest('hex');
const slug=v=>typeof v==='string'&&/^[a-z][a-z0-9-]{1,38}$/u.test(v)&&
  v!=='index'&&!v.endsWith('-');
const validSha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/u.test(v);
function inputPages(input){
  ensure(Array.isArray(input)&&input.length>=2&&input.length<=12,
    'Docs site needs 2–12 frozen Markdown pages','InvalidArgument');
  const seen=new Set();
  return input.map(p=>{
    ensure(p&&typeof p==='object'&&!Array.isArray(p)&&
      Object.keys(p).sort().join(',')==='artifact_id,slug'&&slug(p.slug)&&
      typeof p.artifact_id==='string'&&!seen.has(p.slug),
      'Every docs page needs a unique safe slug and frozen artifact ID','InvalidArgument');
    seen.add(p.slug);
    return{slug:p.slug,artifact_id:p.artifact_id};
  });
}
function readSource(app,{candidate_id,pages,acknowledge_draft_only,acknowledge_unverified,acknowledge_source_rights}){
  ensure(acknowledge_draft_only===true,
    'Private documentation output is not publication: acknowledge this','ConsentRequired');
  ensure(acknowledge_source_rights===true,
    'Operator must explicitly declare source rights for the private docs bundle','ConsentRequired');
  const chosen=inputPages(pages),candidate=app.get(candidate_id,'candidate'),
    release=app.get(candidate.data.release_id,'release');
  const inspection=app.inspectCandidate(candidate);
  ensure(inspection.fresh&&inspection.private_draft_allowed&&
    inspection.editorial_review.state==='APPROVED_EDITORIAL',
    'Documentation site requires a fresh candidate with human editorial approval',
    'ConsentRequired');
  if(inspection.technical_state!=='PASS'){
    ensure(acknowledge_unverified===true,
      'Technical UNKNOWN requires an independent explicit acknowledgement',
      'ConsentRequired');
  }
  const slugs=new Set(chosen.map(p=>p.slug)),seenArtifacts=new Set(),results=[];
  let targetId=null,locale=null,totalSize=0;
  for(const entry of chosen){
    ensure(!seenArtifacts.has(entry.artifact_id),
      'One frozen artifact may not masquerade as two documentation pages','Conflict');
    seenArtifacts.add(entry.artifact_id);
    const artifact=app.get(entry.artifact_id,'artifact');
    const pin=(candidate.data.manifest.artifacts??[]).find(x=>x.id===artifact.id);
    ensure(candidate.data.manifest.artifact_ids.includes(artifact.id)&&
      pin&&pin.sha256===artifact.data.sha256&&
      pin.bytes===artifact.data.size_bytes&&
      pin.mime?.split(';')[0].trim().toLowerCase()==='text/markdown'&&
      artifact.data.release_id===release.id,
      'Every page must be an exact, scoped, frozen Markdown Candidate artifact',
      'PermissionDenied');
    if(targetId===null)targetId=artifact.data.target_id;
    ensure(artifact.data.target_id===targetId,
      'A documentation release cannot silently combine different target audiences',
      'Conflict');
    const bytes=app.store.readBlob(pin.sha256).bytes;
    ensure(bytes.length===pin.bytes&&sha(bytes)===pin.sha256,
      'Immutable Markdown artifact bytes differ from frozen Candidate','Conflict');
    totalSize+=bytes.length;
    ensure(totalSize<=192*1024,'Combined source exceeds safe static-docs budget','ResourceExhausted');
    const parsed=parseStaticDocsMarkdown(bytes,slugs);
    results.push({...entry,bytes,title:parsed.title,
      source_sha256:sha(bytes),links:parsed.links,code_samples:parsed.codeSamples});
  }
  const target=app.get(targetId,'target');
  ensure(target.data.release_id===release.id,
    'Documentation source target is outside candidate release','PermissionDenied');
  locale=target.data.editorial_locale;
  const totalExamples=results.reduce((n,p)=>n+p.code_samples,0),
    links=new Set(results.flatMap(p=>p.links));
  ensure(totalExamples>=1&&links.size>=1,
    'A complete static site requires source code examples and checked internal links',
    'InvalidArgument');
  return{
    candidate,release,target,
    pages:results,totalSize,locale,
    technical_state:inspection.technical_state==='PASS'?'PASS':'UNKNOWN'
  };
}
function contextOf(data){
  return{
    release_id:data.release.id,release_version:data.release.version,
    release:data.release.data.name,build:data.release.data.build,
    candidate_id:data.candidate.id,
    shaValue:data.candidate.data.candidate_sha256,
    locale:data.locale,technical_state:data.technical_state
  };
}
export async function planStaticDocs(app,{
  candidate_id,pages,acknowledge_draft_only=false,acknowledge_unverified=false,
  acknowledge_source_rights=false
}={}){
  const source=readSource(app,{
    candidate_id,pages,acknowledge_draft_only,acknowledge_unverified,
    acknowledge_source_rights
  });
  const output=await renderStaticDocs(source.pages,contextOf(source));
  const core={
    schema_version:STATIC_DOCS_SCHEMA,
    release_id:source.release.id,release_build:source.release.data.build,
    release_version:source.release.version,
    target_id:source.target.id,editorial_locale:source.locale,
    candidate_id,
    candidate_sha256:source.candidate.data.candidate_sha256,
    page_count:source.pages.length+1,
    total_source_bytes:source.totalSize,
    pages:source.pages.map(({bytes,...p})=>p),
    output_zip_sha256:output.zip_sha256,
    output_zip_bytes:output.bytes.length,
    technical_state:source.technical_state,
    private_only:true,acknowledge_unverified:acknowledge_unverified===true,
    source_rights_operator_declared:true,source_rights_independently_verified:false,
    link_validation_performed:true,
    source_application_execution:false,network_access:false,
    publication_authority:false,platform_authority:false,
    customer_acceptance:false
  };
  return{...core,plan_sha256:digest('static-docs-intent',core)};
}
export async function verifyStaticDocsPlan(app,plan){
  validateValue(plan);
  ensure(plan&&typeof plan==='object'&&!Array.isArray(plan),
    'Saved static documentation plan must be a JSON object','InvalidArgument');
  const {plan_sha256,...body}=plan;
  ensure(validSha(plan_sha256)&&digest('static-docs-intent',body)===plan_sha256,
    'Saved documentation plan bytes/digest were modified','Conflict');
  const expected=await planStaticDocs(app,{
    candidate_id:body.candidate_id,
    pages:body.pages.map(p=>({slug:p.slug,artifact_id:p.artifact_id})),
    acknowledge_draft_only:body.private_only,
    acknowledge_unverified:body.acknowledge_unverified,
    acknowledge_source_rights:body.source_rights_operator_declared
  });
  ensure(JSON.stringify(plan)===JSON.stringify(expected),
    'Documentation source, link graph, build or candidate authorization has drifted',
    'StaleReference');
  return expected;
}
const privateDir=path=>{
  ensure(typeof path==='string'&&isAbsolute(path)&&path.length<2048,
    'Select an existing absolute output directory','InvalidArgument');
  const state=lstatSync(path);
  ensure(state.isDirectory()&&!state.isSymbolicLink()&&
    (process.platform==='win32'||(state.mode&0o077)===0),
    'Documentation output directory must be a private real 0700 directory',
    'PermissionDenied');
  return path;
};
export async function exportStaticDocs(app,plan,outdir,{
  confirm_plan_sha256,confirm_candidate_sha256,
  acknowledge_private_export=false
}={}){
  await verifyStaticDocsPlan(app,plan);
  ensure(confirm_plan_sha256===plan.plan_sha256&&
    confirm_candidate_sha256===plan.candidate_sha256&&
    acknowledge_private_export===true,
    'Confirm original plan/candidate SHAs and explicit private file export',
    'ConsentRequired');
  const dir=privateDir(outdir),lock=join(app.store.root,'.static-docs-apply.lock');
  let fd;
  try{fd=openSync(lock,'wx',0o600);}
  catch{throw new NativeError('Conflict',
    'Another static docs export runs or its stale lock needs manual review');}
  try{
    const source=readSource(app,{
      candidate_id:plan.candidate_id,
      pages:plan.pages.map(p=>({slug:p.slug,artifact_id:p.artifact_id})),
      acknowledge_draft_only:true,acknowledge_unverified:plan.acknowledge_unverified,
      acknowledge_source_rights:plan.source_rights_operator_declared
    });
    const rendered=await renderStaticDocs(source.pages,contextOf(source));
    ensure(rendered.zip_sha256===plan.output_zip_sha256&&
      rendered.bytes.length===plan.output_zip_bytes&&
      rendered.page_count===plan.page_count,
      'Output bytes or pages differ from exact reviewed plan','Conflict');
    const basename='launchwright-docs-'+plan.plan_sha256.slice(0,12);
    const receipt={
      schema_version:'launchwright-static-docs-receipt/1',
      plan_sha256:plan.plan_sha256,candidate_sha256:plan.candidate_sha256,
      release_id:plan.release_id,release_build:plan.release_build,
      target_id:plan.target_id,locale:plan.editorial_locale,
      source_pages:plan.pages.map(p=>({artifact_id:p.artifact_id,
        source_sha256:p.source_sha256,slug:p.slug})),
      archive_sha256:rendered.zip_sha256,archive_bytes:rendered.bytes.length,
      html_pages:rendered.page_count,
      links_verified:true,code_examples_inert:true,
      technical_state:plan.technical_state,
      private_only:true,external_network:false,
      source_rights_operator_declared:true,source_rights_independently_verified:false,
      published:false,platform_authority:false,customer_acceptance:false
    };
    const files=[
      {name:basename+'.zip',bytes:rendered.bytes},
      {name:basename+'.receipt.json',bytes:Buffer.from(JSON.stringify(receipt,null,2)+'\n')}
    ];
    // All existing outputs are compared BEFORE writing new files, preventing
    // clobber and partial new work following a collision.
    for(const f of files){
      const path=join(dir,f.name);
      if(!existsSync(path))continue;
      const state=lstatSync(path);
      ensure(state.isFile()&&!state.isSymbolicLink()&&
        (process.platform==='win32'||(state.mode&0o077)===0)&&
        sha(readFileSync(path))===sha(f.bytes),
        'Existing docs site/receipt was modified; never overwrite it','Conflict');
    }
    let created=0;
    for(const f of files){
      const path=join(dir,f.name);
      if(existsSync(path))continue;
      writeFileSync(path,f.bytes,{mode:0o600,flag:'wx'});created++;
    }
    return{...receipt,files_created:created,recovered:created===0};
  }finally{
    try{closeSync(fd);}finally{unlinkSync(lock);}
  }
}
