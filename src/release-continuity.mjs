// SPDX-License-Identifier: AGPL-3.0-only
// R54: exact two-release continuity from canonical local Native SDK state.
// This is a review artifact, NEVER proof of product execution, complete
// Project Graph coverage, external publication, or client deployment.
import { createHash } from 'node:crypto';
import { closeSync,existsSync,lstatSync,openSync,readFileSync,writeFileSync,unlinkSync } from 'node:fs';
import { isAbsolute,join } from 'node:path';
import { requireCondition as ensure,validateValue,NativeError } from '@semwright/native-sdk';
import { digest } from './base.mjs';
import { deterministicZip } from './channel-bundle.mjs';
import { renderContinuityReview } from './release-continuity-view.mjs';

export const RELEASE_CONTINUITY_SCHEMA='launchwright-release-continuity-plan/1';
const sha=value=>createHash('sha256').update(value).digest('hex');
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/u.test(value);
const lex=(a,b)=>a<b?-1:a>b?1:0;
function privateDir(dir){
  ensure(typeof dir==='string'&&isAbsolute(dir)&&dir.length<=2048,
    'Choose an existing absolute private 0700 output directory','InvalidArgument');
  const stat=lstatSync(dir);
  ensure(stat.isDirectory()&&!stat.isSymbolicLink()&&
    (process.platform==='win32'||(stat.mode&0o077)===0),
    'Output directory must be real and private (0700 on POSIX)','PermissionDenied');
  return dir;
}
function slot(artifact,deliverable,target){
  const semantics=[
    target.data.name,target.data.editorial_locale,target.data.role,
    target.data.plan,target.data.region,deliverable.data.name,deliverable.data.format
  ];
  ensure(semantics.every(x=>typeof x==='string'&&x.length<=160),
    'Target or deliverable identity is ambiguous','InvalidArgument');
  return JSON.stringify(semantics);
}
function projection(app,releaseId,candidateId){
  const release=app.get(releaseId,'release');
  const candidate=app.get(candidateId,'candidate');
  ensure(candidate.data.release_id===release.id,
    'Candidate belongs to another release','PermissionDenied');
  const inspected=app.inspectCandidate(candidate);
  ensure(inspected.fresh,
    'Historical or current candidate inputs have drifted; an exact frozen comparison needs a preserved source snapshot',
    'StaleReference');
  const manifest=candidate.data.manifest;
  ensure(Array.isArray(manifest.artifacts)&&manifest.artifacts.length>0&&
    manifest.artifacts.length<=32,
    'Continuity requires 1–32 immutable candidate artifacts','ResourceExhausted');
  const matches=new Set();
  const artifacts=manifest.artifacts.map(frozen=>{
    const artifact=app.get(frozen.id,'artifact');
    ensure(artifact.data.release_id===release.id&&
      artifact.data.sha256===frozen.sha256&&
      artifact.data.size_bytes===frozen.bytes,
      'A candidate artifact no longer matches its frozen immutable manifest',
      'Conflict');
    ensure(app.freshness(artifact.data.inputs).length===0,
      'Frozen artifact source revisions changed; current copy cannot impersonate historical editorial copy',
      'StaleReference');
    const bytes=app.store.readBlob(frozen.sha256).bytes;
    ensure(bytes.length===frozen.bytes&&sha(bytes)===frozen.sha256,
      'Candidate blob integrity changed','Conflict');
    const target=app.get(artifact.data.target_id,'target'),
      deliverable=app.get(artifact.data.deliverable_id,'deliverable');
    ensure(target.data.release_id===release.id&&deliverable.data.release_id===release.id&&
      deliverable.data.target_id===target.id,
      'Candidate target/deliverable scope has drifted','PermissionDenied');
    const key=slot(artifact,deliverable,target);
    ensure(!matches.has(key),
      'Two artifacts share one semantic target/document identity. Select a disambiguated candidate',
      'Conflict');
    matches.add(key);
    const contentFingerprint=digest('continuity-editorial-content',{
      format:deliverable.data.format,content:deliverable.data.content??null,
      captions:deliverable.data.captions??null
    });
    const pinnedSource=manifest.inputs?.filter(p=>p.kind==='source'||
      p.kind==='evidence'||p.kind==='claim').map(p=>({
      kind:p.kind,id:p.id,version:p.version
    }))??[];
    return{
      key,
      title:deliverable.data.name,format:deliverable.data.format,
      target_name:target.data.name,locale:target.data.editorial_locale,
      role:target.data.role,plan:target.data.plan,region:target.data.region,
      artifact_id:artifact.id,artifact_sha256:frozen.sha256,
      artifact_bytes:frozen.bytes,mime:frozen.mime,producer:frozen.producer,
      source_copy_sha256:contentFingerprint,
      declared_source_pins:pinnedSource,
      // Same copy is not the same observed product behavior.
      technical_state:artifact.data.technical??'UNKNOWN'
    };
  }).sort((a,b)=>lex(a.key,b.key));
  const claimCoverage=app.coverage(release.id),impact=app.impact(release.id);
  const channel=app.channelStatus(release.id);
  const channelState=channel.latest.map(c=>({
    channel_profile_id:c.data.profile_id,
    state:c.data.state,
    external_state:c.data.external_state,
    candidate_sha256:c.data.candidate_sha256
  })).sort((a,b)=>lex(a.channel_profile_id,b.channel_profile_id));
  return{
    release_id:release.id,release_name:release.data.name,
    product_id:release.data.product_id,build:release.data.build,
    candidate_id:candidate.id,candidate_sha256:candidate.data.candidate_sha256,
    candidate_fresh:inspected.fresh,
    candidate_editorial:inspected.editorial_review.state,
    candidate_technical:inspected.technical_state,
    private_draft_allowed:inspected.private_draft_allowed,
    release_coverage:{
      registered_claims:claimCoverage.obligations,
      reported_pass:claimCoverage.pass,
      reported_fail:claimCoverage.fail,
      reported_unknown:claimCoverage.unknown,
      registered_scenarios:claimCoverage.scenarios.length,
      unknown_frontier:claimCoverage.unknown_frontier,
      scope:claimCoverage.inventory_scope
    },
    impact:{
      coverage:impact.coverage,
      canonical_graph_authority:impact.canonical_graph_authority,
      unknown_frontier:impact.unknown_frontier,
      changed_pinned_artifacts:impact.items.length,
      contract_blockers:impact.contract_blockers.length
    },
    channels:channelState,
    artifacts
  };
}
function compare(before,after){
  const old=new Map(before.artifacts.map(row=>[row.key,row]));
  const next=new Map(after.artifacts.map(row=>[row.key,row]));
  return [...new Set([...old.keys(),...next.keys()])].sort(lex).map(key=>{
    const previous=old.get(key)??null,current=next.get(key)??null;
    const status=!previous?'ADDED':!current?'REMOVED':
      previous.artifact_sha256===current.artifact_sha256?'UNCHANGED':'CHANGED';
    return{
      key,title:(current??previous).title,
      target_name:(current??previous).target_name,
      locale:(current??previous).locale,
      format:(current??previous).format,
      status,previous_artifact_sha256:previous?.artifact_sha256??null,
      current_artifact_sha256:current?.artifact_sha256??null,
      previous_source_copy_sha256:previous?.source_copy_sha256??null,
      current_source_copy_sha256:current?.source_copy_sha256??null,
      editorial_copy_unchanged:previous!==null&&current!==null&&
        previous.source_copy_sha256===current.source_copy_sha256,
      reused_across_builds:false,
      // Every row requires re-review before making feature/publish claims.
      technical_truth:'NOT_PROVED_BY_CROSS_RELEASE_HASHES'
    };
  });
}
export function continuityReport(app,{
  before_release_id,after_release_id,before_candidate_id,after_candidate_id
}={}){
  app.allow('read');
  const before=projection(app,before_release_id,before_candidate_id),
    after=projection(app,after_release_id,after_candidate_id);
  ensure(before.release_id!==after.release_id,
    'Two distinct releases are required','InvalidArgument');
  ensure(before.product_id===after.product_id,
    'Cannot compare releases owned by different products','PermissionDenied');
  ensure(before.build!==after.build,
    'Two distinct versioned build identities are required','InvalidArgument');
  const changes=compare(before,after);
  ensure(changes.length<=64,'Continuity comparison exceeds bounded artifact inventory','ResourceExhausted');
  const counts=Object.fromEntries(['ADDED','REMOVED','CHANGED','UNCHANGED'].map(
    state=>[state.toLowerCase(),changes.filter(c=>c.status===state).length]));
  return{
    schema_version:'launchwright-release-continuity-report/1',
    product_id:before.product_id,before,after,changes,counts,
    current_release_needs_review:after.candidate_editorial!=='APPROVED_EDITORIAL'||
      !after.candidate_fresh,
    historical_release_preserved:true,
    no_automatic_reuse:true,
    inference_scope:'DECLARED_AND_PINNED_WORKSPACE_RECORDS_ONLY',
    technical_behavior_verified:false,
    external_publication_verified:false,
    cross_tenant_authority:false,
    platform_publish_authority:false,
    registered_graph_scope_fully_observed:before.impact.canonical_graph_authority&&
      !before.impact.unknown_frontier&&after.impact.canonical_graph_authority&&
      !after.impact.unknown_frontier,
    missing_evidence_warning:'Artifact/copy equality is NOT proof that product behavior or external availability is unchanged.'
  };
}
export function planReleaseContinuity(app,input){
  validateValue(input);
  ensure(input&&typeof input==='object'&&!Array.isArray(input)&&
    Object.keys(input).sort().join(',')===
      ['acknowledge_incomplete_coverage','acknowledge_private_only',
       'after_candidate_id','after_release_id','before_candidate_id',
       'before_release_id'].sort().join(','),
    'Continuity requires exact two-release identities and approvals','InvalidArgument');
  ensure(input.acknowledge_private_only===true&&
    input.acknowledge_incomplete_coverage===true,
    'A review export requires explicit acknowledgement of private-only and incomplete evidence',
    'ConsentRequired');
  const model=continuityReport(app,input);
  const core={
    schema_version:RELEASE_CONTINUITY_SCHEMA,
    before_release_id:model.before.release_id,after_release_id:model.after.release_id,
    before_candidate_id:model.before.candidate_id,after_candidate_id:model.after.candidate_id,
    before_candidate_sha256:model.before.candidate_sha256,
    after_candidate_sha256:model.after.candidate_sha256,
    report_sha256:digest('release-continuity-model',model),
    changed_artifacts:model.counts.changed,
    added_artifacts:model.counts.added,removed_artifacts:model.counts.removed,
    unchanged_artifacts:model.counts.unchanged,
    private_only:true,incomplete_coverage_acknowledged:true,
    external_send_authority:false,publication_authority:false,
    platform_authority:false
  };
  return{...core,plan_sha256:digest('release-continuity-plan',core)};
}
export function verifyReleaseContinuity(app,plan){
  validateValue(plan);
  ensure(plan&&typeof plan==='object'&&!Array.isArray(plan),
    'Saved two-release plan must be an object','InvalidArgument');
  const {plan_sha256,...core}=plan;
  ensure(hex(plan_sha256)&&digest('release-continuity-plan',core)===plan_sha256,
    'Saved two-release plan SHA differs from original','Conflict');
  const expected=planReleaseContinuity(app,{
    before_release_id:core.before_release_id,
    after_release_id:core.after_release_id,
    before_candidate_id:core.before_candidate_id,
    after_candidate_id:core.after_candidate_id,
    acknowledge_private_only:core.private_only,
    acknowledge_incomplete_coverage:core.incomplete_coverage_acknowledged
  });
  ensure(JSON.stringify(expected)===JSON.stringify(plan),
    'Release inputs, receipts or candidate state changed since plan','StaleReference');
  return expected;
}
export async function exportReleaseContinuity(app,plan,outDir,{
  confirm_plan_sha256,confirm_before_candidate_sha256,
  confirm_after_candidate_sha256,acknowledge_private_export=false
}={}){
  verifyReleaseContinuity(app,plan);
  ensure(confirm_plan_sha256===plan.plan_sha256 &&
    confirm_before_candidate_sha256===plan.before_candidate_sha256 &&
    confirm_after_candidate_sha256===plan.after_candidate_sha256 &&
    acknowledge_private_export===true,
    'Operator must confirm exact plan and both frozen candidate hashes','ConsentRequired');
  const dir=privateDir(outDir),root=app.store.root;
  const lockfile=join(root,'.release-continuity-export.lock');
  let lock;
  try{lock=openSync(lockfile,'wx',0o600);}catch{
    throw new NativeError('Conflict',
      'Continuity export is running or an unknown operator lock remains','Conflict');
  }
  try{
    // Read all source state again under the exclusive operator export lock.
    verifyReleaseContinuity(app,plan);
    const report=continuityReport(app,plan);
    const bytes=Buffer.from(JSON.stringify(report,null,2)+'\n');
    const html=Buffer.from(renderContinuityReview(report,plan));
    const bundle=deterministicZip([
      {name:'report.json',bytes},{name:'index.html',bytes:html},
      {name:'README.txt',bytes:Buffer.from(
        'Launchwright private two-release continuity dossier.\n'+
        'Only operator-known workspace resources are enumerated. Unknown evidence remains unknown.\n'+
        'No automatic reuse, source app execution, Platform Publish, customer acceptance or public release.\n'
      )}
    ]);
    const prefix='launchwright-continuity-'+plan.plan_sha256.slice(0,12);
    const receipt={
      schema_version:'launchwright-release-continuity-receipt/1',
      plan_sha256:plan.plan_sha256,
      before_candidate_sha256:plan.before_candidate_sha256,
      after_candidate_sha256:plan.after_candidate_sha256,
      report_sha256:sha(bytes),html_sha256:sha(html),
      zip_sha256:bundle.sha256,zip_bytes:bundle.bytes.length,
      change_counts:report.counts,
      private_only:true,unknown_frontier:true,
      external_send_performed:false,platform_authority:false,
      technical_behavior_verified:false,external_publication_verified:false
    };
    const assets=[
      {name:prefix+'.zip',bytes:bundle.bytes},
      {name:prefix+'.receipt.json',bytes:Buffer.from(JSON.stringify(receipt,null,2)+'\n')}
    ];
    for(const file of assets){
      const path=join(dir,file.name);
      if(!existsSync(path))continue;
      const stat=lstatSync(path);
      ensure(stat.isFile()&&!stat.isSymbolicLink()&&
        (process.platform==='win32'||(stat.mode&0o077)===0)&&
        sha(readFileSync(path))===sha(file.bytes),
        'Existing continuity report was edited or belongs to a different plan',
        'Conflict');
    }
    let created=0;
    for(const file of assets){
      if(existsSync(join(dir,file.name)))continue;
      writeFileSync(join(dir,file.name),file.bytes,{flag:'wx',mode:0o600});
      created++;
    }
    return{...receipt,filename:assets[0].name,files_created:created,
      recovered:created===0};
  }finally{
    try{closeSync(lock);}finally{unlinkSync(lockfile);}
  }
}
