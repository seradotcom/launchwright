// SPDX-License-Identifier: AGPL-3.0-only
// R70: opt-in, never automatic, human-review-only editorial carry-forward.
// Reuses canonical Native SDK entity + relation transactions and immutable
// candidate bytes. Claims, evidence, approvals and artifacts never transfer.
import {createHash} from 'node:crypto';
import {openSync,closeSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {requireCondition as ensure,validateValue,NativeError} from '@semwright/native-sdk';
import {digest,str,lines} from './contracts.mjs';
import {execute} from './application.mjs';

export const CARRY_FORWARD_SCHEMA='launchwright-release-carry-forward-plan/1';
const sha=value=>createHash('sha256').update(value).digest('hex');
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/u.test(value);
const exact=(obj,fields)=>ensure(obj&&typeof obj==='object'&&!Array.isArray(obj)&&
  Object.keys(obj).length===fields.length&&fields.every(k=>Object.hasOwn(obj,k)),
  'Carry-forward request has unexpected or missing fields','InvalidArgument');
const planFields=['source_candidate_id','source_artifact_id',
  'destination_release_id','destination_target_id','destination_name',
  'acknowledge_historical_rights','acknowledge_editorial_recheck'];
const context=value=>({
  ui_locale:value.ui_locale,editorial_locale:value.editorial_locale,
  role:value.role,plan:value.plan,region:value.region,flags:value.flags
});
function sourceAndDestination(app,request){
  app.allow('read');
  const candidate=app.get(request.source_candidate_id,'candidate');
  const sourceRelease=app.get(candidate.data.release_id,'release');
  const release=app.get(request.destination_release_id,'release');
  const target=app.get(request.destination_target_id,'target');
  ensure(sourceRelease.id!==release.id&&sourceRelease.data.product_id===release.data.product_id,
    'Carry-forward requires two different releases belonging to one product','PermissionDenied');
  ensure(sourceRelease.data.build!==release.data.build,
    'A new commercial build identity is required','InvalidArgument');
  ensure(release.data.status==='draft'&&target.data.release_id===release.id,
    'Carry-forward creates drafts in an editable destination release only','PermissionDenied');
  const frozen=candidate.data.manifest.artifacts?.find(row=>
    row.id===request.source_artifact_id);
  ensure(frozen?.mime?.split(';')[0].trim().toLowerCase()==='text/markdown'&&
    frozen.sha256&&frozen.bytes>0&&frozen.bytes<=128*1024,
    'Only a frozen Markdown artifact may be carried forward','PermissionDenied');
  const artifact=app.get(frozen.id,'artifact');
  ensure(artifact.data.release_id===sourceRelease.id&&
    artifact.data.sha256===frozen.sha256&&
    artifact.data.size_bytes===frozen.bytes&&
    artifact.data.deliverable_id===frozen.deliverable_id,
    'Frozen Markdown does not match the source artifact','Conflict');
  const document=app.get(frozen.deliverable_id,'deliverable');
  const sourceTarget=app.get(document.data.target_id,'target');
  ensure(document.data.release_id===sourceRelease.id&&
    sourceTarget.data.release_id===sourceRelease.id&&
    document.data.format==='markdown'&&
    artifact.data.target_id===sourceTarget.id,
    'Source Markdown identity differs from the frozen candidate','Conflict');
  ensure(document.data.claim_ids.length===0&&
    (document.data.copy_block_ids??[]).length===0,
    'Claim-linked or CopyBlock-managed text cannot be carried forward as unverified copy',
    'PolicyDenied');
  ensure(JSON.stringify(context(sourceTarget.data))===JSON.stringify(context(target.data))&&
    sourceTarget.data.name===target.data.name,
    'Target locale, audience, flags or name changed; a new editorial draft is required',
    'StaleReference');
  const inspected=app.inspectCandidate(candidate);
  ensure(inspected.fresh&&inspected.private_draft_allowed&&
    inspected.editorial_review.state==='APPROVED_EDITORIAL',
    'Historical candidate must remain exact, fresh and human editorial-approved',
    'ConsentRequired');
  ensure(app.freshness(artifact.data.inputs).length===0,
    'Historical Markdown source revisions changed','StaleReference');
  const bytes=app.store.readBlob(frozen.sha256).bytes;
  ensure(bytes.length===frozen.bytes&&sha(bytes)===frozen.sha256,
    'Historical artifact bytes differ from its frozen manifest','Conflict');
  ensure(Buffer.byteLength(document.data.content,'utf8')>0&&
    Buffer.byteLength(document.data.content,'utf8')<=20500,
    'Historical Markdown is empty or exceeds the carry-forward budget',
    'ResourceExhausted');
  const approvalSha=digest('r70-approved-candidate-reviews',
    inspected.reviews.map(r=>({id:r.id,version:r.version,data:r.data}))
      .sort((a,b)=>a.id.localeCompare(b.id)));
  return{candidate,sourceRelease,release,target,sourceTarget,artifact,document,
    original:document.data.content,approvalSha};
}
function draftContent(x){
  return[
    '> **CARRY-FORWARD DRAFT — REVERIFY FOR THIS BUILD BEFORE USE.**',
    '> Historical editorial copy was reviewed for a DIFFERENT build, not for',
    '> the destination release. No technical claims, availability, rights,',
    '> references, product behavior, approvals or publication are inherited.',
    '> Source build: '+x.sourceRelease.data.build,
    '> Destination build: '+x.release.data.build,
    '> Frozen source candidate SHA-256: '+x.candidate.data.candidate_sha256,
    '> Frozen Markdown artifact SHA-256: '+x.artifact.data.sha256,
    '',
    '---','',''+x.original
  ].join('\n');
}
export function prepareCarryForward(app,request){
  validateValue(request);exact(request,planFields);
  ensure(request.acknowledge_historical_rights===true&&
    request.acknowledge_editorial_recheck===true,
    'Owner must declare historical source rights and manual re-review',
    'ConsentRequired');
  str(request.destination_name,115);
  ensure(request.destination_name.trim().length>0&&
    !/[\x00-\x1f\x7f]/u.test(request.destination_name),
    'Use a bounded single-line new editorial title','InvalidArgument');
  const x=sourceAndDestination(app,request);
  const text=draftContent(x);lines(text,24000);
  const core={
    schema_version:CARRY_FORWARD_SCHEMA,
    source_candidate_id:x.candidate.id,
    source_candidate_sha256:x.candidate.data.candidate_sha256,
    source_candidate_version:x.candidate.version,
    source_review_sha256:x.approvalSha,
    source_release_id:x.sourceRelease.id,source_build:x.sourceRelease.data.build,
    source_artifact_id:x.artifact.id,source_artifact_sha256:x.artifact.data.sha256,
    source_deliverable_id:x.document.id,source_deliverable_version:x.document.version,
    source_content_sha256:sha(Buffer.from(x.original,'utf8')),
    destination_release_id:x.release.id,
    destination_release_version:x.release.version,
    destination_target_id:x.target.id,destination_target_version:x.target.version,
    destination_build:x.release.data.build,
    destination_name:request.destination_name,
    new_content_sha256:sha(Buffer.from(text,'utf8')),
    target_context_sha256:digest('r70-matched-target',context(x.target.data)),
    imported_references:0,claims_inherited:false,evidence_inherited:false,
    copied_artifact_bytes:false,review_required:true,
    technical_state:'UNKNOWN',private_only:true,
    rights_operator_declared:true,rights_independently_verified:false,
    external_send_performed:false,customer_acceptance:false,
    platform_authority:false,published:false
  };
  const plan_sha256=digest('r70-carry-forward-plan',core);
  return{...core,plan_sha256,
    created_name:request.destination_name+' · review '+plan_sha256.slice(0,12)};
}
export function verifyCarryForward(app,plan){
  validateValue(plan);
  ensure(plan&&typeof plan==='object'&&!Array.isArray(plan),
    'Saved carry-forward plan must be a plain object','InvalidArgument');
  const {plan_sha256,created_name,...core}=plan;
  ensure(hex(plan_sha256)&&digest('r70-carry-forward-plan',core)===plan_sha256&&
    created_name===core.destination_name+' · review '+plan_sha256.slice(0,12),
    'Saved carry-forward plan has been altered','Conflict');
  const expected=prepareCarryForward(app,{
    source_candidate_id:core.source_candidate_id,
    source_artifact_id:core.source_artifact_id,
    destination_release_id:core.destination_release_id,
    destination_target_id:core.destination_target_id,
    destination_name:core.destination_name,
    acknowledge_historical_rights:core.rights_operator_declared,
    acknowledge_editorial_recheck:core.review_required
  });
  ensure(JSON.stringify(expected)===JSON.stringify(plan),
    'Frozen source, approval, target or destination build drifted after planning',
    'StaleReference');
  return expected;
}
function existing(app,plan){
  const found=app.list('deliverable',plan.destination_release_id).filter(d=>
    d.data.name===plan.created_name);
  ensure(found.length<=1,'Multiple drafts have the same exact plan identity','Conflict');
  const doc=found[0]??null;
  if(doc)ensure(doc.data.release_id===plan.destination_release_id&&
    doc.data.target_id===plan.destination_target_id&&
    doc.data.format==='markdown'&&doc.data.claim_ids.length===0&&
    (doc.data.copy_block_ids??[]).length===0&&doc.data.source_ids.length===0&&
    sha(Buffer.from(doc.data.content,'utf8'))===plan.new_content_sha256,
    'An existing carried draft was edited or contains foreign references',
    'Conflict');
  const name='Carry-forward provenance '+plan.plan_sha256;
  const relations=app.list('relation',plan.destination_release_id).filter(r=>
    r.data.name===name);
  ensure(relations.length<=1,'Ambiguous carry-forward provenance','Conflict');
  const relation=relations[0]??null;
  if(relation)ensure(doc&&relation.data.from_id===plan.source_deliverable_id&&
    relation.data.to_id===doc.id&&relation.data.relation_kind==='editorial_carry_forward'&&
    relation.data.provenance==='declared'&&relation.data.completeness==='unknown'&&
    relation.data.admission==='local-explicit-record'&&
    JSON.stringify(relation.data.from_version)===
      JSON.stringify(plan.source_deliverable_version)&&
    JSON.stringify(relation.data.to_version)===JSON.stringify(doc.version),
    'Carry-forward provenance differs from its original Native source',
    'Conflict');
  return{doc,relation};
}
export function inspectCarryForward(app,plan){
  app.allow('read');verifyCarryForward(app,plan);
  const {doc,relation}=existing(app,plan);
  const state=!doc?'NOT_APPLIED':!relation?'PARTIAL_NEEDS_RECONCILIATION':'DRAFT_READY';
  return{schema_version:'launchwright-carry-forward-status/1',
    plan_sha256:plan.plan_sha256,state,
    deliverable_id:doc?.id??null,relation_id:relation?.id??null,
    destination_release_id:plan.destination_release_id,
    claims_inherited:false,evidence_inherited:false,
    historical_artifact_reused:false,technical_state:'UNKNOWN',
    editorial_approval_inherited:false,external_send_performed:false,
    published:false,platform_authority:false};
}
export async function applyCarryForwardUnderLock(app,plan,{
  confirm_plan_sha256,confirm_source_candidate_sha256,confirm_destination_build,
  acknowledge_create_draft=false
}={}){
  app.allow('edit');verifyCarryForward(app,plan);
  ensure(confirm_plan_sha256===plan.plan_sha256&&
    confirm_source_candidate_sha256===plan.source_candidate_sha256&&
    confirm_destination_build===plan.destination_build&&
    acknowledge_create_draft===true,
    'Operator must confirm exact plan, historical candidate and new build',
    'ConsentRequired');
    verifyCarryForward(app,plan);
    let{doc,relation}=existing(app,plan);
    const created=doc===null,linked=relation===null;
    if(!doc){
      const source=sourceAndDestination(app,{
        source_candidate_id:plan.source_candidate_id,
        source_artifact_id:plan.source_artifact_id,
        destination_release_id:plan.destination_release_id,
        destination_target_id:plan.destination_target_id,
        destination_name:plan.destination_name
      });
      doc=(await execute(app,'entity.create',{kind:'deliverable',data:{
        release_id:plan.destination_release_id,
        target_id:plan.destination_target_id,name:plan.created_name,
        format:'markdown',content:draftContent(source),
        claim_ids:[],copy_block_ids:[],source_ids:[]
      }})).entity;
    }
    if(!relation){
      relation=(await execute(app,'relation.record',{
        release_id:plan.destination_release_id,
        name:'Carry-forward provenance '+plan.plan_sha256,
        from_id:plan.source_deliverable_id,to_id:doc.id,
        relation_kind:'editorial_carry_forward',
        provenance:'declared',completeness:'unknown',evidence_ids:[]
      })).entity;
    }
    const readback=inspectCarryForward(app,plan);
    ensure(readback.state==='DRAFT_READY'&&
      readback.deliverable_id===doc.id&&readback.relation_id===relation.id,
      'New draft provenance could not be read back from Native SDK state',
      'Conflict');
    return{...readback,created_deliverable:created,created_relation:linked,
      recovered:!created&&!linked,workspace_mutated:created||linked};
}
export async function withCarryForwardLock(app,callback){
  app.allow('edit');
  const lock=join(app.store.root,'.release-carry-forward.lock');
  let fd;
  try{fd=openSync(lock,'wx',0o600);}catch{
    throw new NativeError('Conflict',
      'A carry-forward writer or uncertain operation already owns the lock');
  }
  try{return await callback();}
  finally{
    try{closeSync(fd);}finally{unlinkSync(lock);}
  }
}
// R70 public entry point still requires independent confirmation before lock.
// R71 can use the same shared lock to serialize an entire bounded batch and
// avoid racing an individual R70 write between two selected documents.
export async function applyCarryForward(app,plan,confirmation={}){
  app.allow('edit');
  verifyCarryForward(app,plan);
  ensure(confirmation.confirm_plan_sha256===plan.plan_sha256&&
    confirmation.confirm_source_candidate_sha256===plan.source_candidate_sha256&&
    confirmation.confirm_destination_build===plan.destination_build&&
    confirmation.acknowledge_create_draft===true,
    'Operator must confirm exact plan, historical candidate and new build',
    'ConsentRequired');
  return withCarryForwardLock(app,()=>
    applyCarryForwardUnderLock(app,plan,confirmation));
}
