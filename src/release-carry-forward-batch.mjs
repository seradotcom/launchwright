// SPDX-License-Identifier: AGPL-3.0-only
// R71: bounded multi-document handoff using exclusively the reviewed R70
// Native plans and the SAME exclusive writer lock. Deliberate partial
// progress is inspectable and recoverable, never mistaken for atomic success.
import {requireCondition as ensure,validateValue} from '@semwright/native-sdk';
import {digest,str,array} from './contracts.mjs';
import {
  prepareCarryForward,verifyCarryForward,inspectCarryForward,
  withCarryForwardLock,applyCarryForwardUnderLock
} from './release-carry-forward.mjs';

export const CARRY_FORWARD_BATCH_SCHEMA='launchwright-carry-forward-batch-plan/1';
const HEX64=/^[a-f0-9]{64}$/u;
const fields=['source_candidate_id','destination_release_id','items',
  'acknowledge_historical_rights','acknowledge_editorial_recheck'];
const strict=(obj,allowed)=>{
  ensure(obj&&typeof obj==='object'&&!Array.isArray(obj)&&
    Object.keys(obj).length===allowed.length&&
    allowed.every(key=>Object.hasOwn(obj,key)),
    'Unexpected or missing carry-forward batch fields','InvalidArgument');
};
const authorizations={
  claims_inherited:false,evidence_inherited:false,source_reused_as_authority:false,
  editorial_approval_inherited:false,artifacts_reused:false,
  rights_independently_verified:false,technical_state:'UNKNOWN',
  project_graph_authority:false,platform_authority:false,
  external_send_performed:false,published:false,customer_acceptance:false
};
export function prepareCarryForwardBatch(app,raw){
  app.allow('read');validateValue(raw);strict(raw,fields);
  ensure(raw.acknowledge_historical_rights===true&&
    raw.acknowledge_editorial_recheck===true,
    'Explicit rights declaration and fresh human editorial review required',
    'ConsentRequired');
  const selected=array(raw.items,8);
  ensure(selected.length>=2,
    'Select at least two and no more than eight historical Markdown artifacts',
    'InvalidArgument');
  const choices=selected.map(row=>{
    strict(row,['source_artifact_id','destination_target_id','destination_name']);
    str(row.destination_name,115);
    return row;
  });
  ensure(new Set(choices.map(x=>x.source_artifact_id)).size===choices.length,
    'Every frozen Markdown Artifact can be selected only once','Conflict');
  ensure(new Set(choices.map(x=>
    x.destination_target_id+'\0'+x.destination_name.trim().toLowerCase()
  )).size===choices.length,
    'Each target/title pair must be unambiguous within a batch','Conflict');

  const plans=choices.map(row=>prepareCarryForward(app,{
    source_candidate_id:raw.source_candidate_id,
    destination_release_id:raw.destination_release_id,
    ...row,
    acknowledge_historical_rights:true,
    acknowledge_editorial_recheck:true
  })).sort((a,b)=>a.source_artifact_id.localeCompare(b.source_artifact_id));
  const sourceCandidate=app.get(raw.source_candidate_id,'candidate');
  const release=app.get(raw.destination_release_id,'release');
  ensure(plans.every(p=>
    p.source_candidate_id===sourceCandidate.id&&
    p.source_candidate_sha256===sourceCandidate.data.candidate_sha256&&
    p.destination_release_id===release.id&&
    p.destination_build===release.data.build
  ),'All selected artifacts must share the exact same frozen Candidate and destination build',
  'Conflict');
  const core={
    schema_version:CARRY_FORWARD_BATCH_SCHEMA,
    source_candidate_id:sourceCandidate.id,
    source_candidate_sha256:sourceCandidate.data.candidate_sha256,
    destination_release_id:release.id,
    destination_build:release.data.build,
    document_count:plans.length,
    plans,
    acknowledgement_rights:true,acknowledgement_fresh_review:true,
    ...authorizations
  };
  return{...core,plan_sha256:digest('r71-carry-forward-batch',core)};
}
export function verifyCarryForwardBatch(app,plan){
  app.allow('read');validateValue(plan);
  const planFields=['schema_version','source_candidate_id',
    'source_candidate_sha256','destination_release_id','destination_build',
    'document_count','plans','acknowledgement_rights',
    'acknowledgement_fresh_review',...Object.keys(authorizations),
    'plan_sha256'];
  strict(plan,planFields);
  ensure(plan.schema_version===CARRY_FORWARD_BATCH_SCHEMA&&
    typeof plan.plan_sha256==='string'&&HEX64.test(plan.plan_sha256),
    'Saved plan does not have the exact bounded R71 identity',
    'InvalidArgument');
  const{plan_sha256,...core}=plan;
  ensure(digest('r71-carry-forward-batch',core)===plan_sha256,
    'Saved batch identity changed after operator review','Conflict');
  ensure(Array.isArray(plan.plans)&&
    plan.document_count===plan.plans.length&&
    plan.document_count>=2&&plan.document_count<=8,
    'Batch plan size differs from selected documents','Conflict');
  for(const child of plan.plans)verifyCarryForward(app,child);
  const reconstructed=prepareCarryForwardBatch(app,{
    source_candidate_id:plan.source_candidate_id,
    destination_release_id:plan.destination_release_id,
    items:plan.plans.map(p=>({
      source_artifact_id:p.source_artifact_id,
      destination_target_id:p.destination_target_id,
      destination_name:p.destination_name
    })),
    acknowledge_historical_rights:plan.acknowledgement_rights,
    acknowledge_editorial_recheck:plan.acknowledgement_fresh_review
  });
  ensure(JSON.stringify(reconstructed)===JSON.stringify(plan),
    'Saved batch no longer matches frozen Native candidate, reviewer or target revision',
    'StaleReference');
  return plan;
}
export function inspectCarryForwardBatch(app,plan){
  app.allow('read');verifyCarryForwardBatch(app,plan);
  const rows=plan.plans.map(child=>{
    const inspected=inspectCarryForward(app,child);
    return{
      source_artifact_id:child.source_artifact_id,
      source_artifact_sha256:child.source_artifact_sha256,
      destination_target_id:child.destination_target_id,
      destination_name:child.destination_name,
      created_name:child.created_name,
      plan_sha256:child.plan_sha256,
      state:inspected.state,
      deliverable_id:inspected.deliverable_id,
      provenance_relation_id:inspected.relation_id,
      ...authorizations
    };
  });
  const complete=rows.filter(row=>row.state==='DRAFT_READY').length;
  const partial=rows.filter(row=>row.state==='PARTIAL_NEEDS_RECONCILIATION').length;
  const untouched=rows.length-complete-partial;
  const state=complete===rows.length?'BATCH_READY':
    complete===0&&partial===0?'NOT_APPLIED':'PARTIAL_NEEDS_RECONCILIATION';
  return{
    schema_version:'launchwright-carry-forward-batch-status/1',
    plan_sha256:plan.plan_sha256,state,source_candidate_id:plan.source_candidate_id,
    destination_release_id:plan.destination_release_id,
    completed_documents:complete,
    incomplete_documents:partial,
    untouched_documents:untouched,
    total_documents:rows.length,
    rows,requires_manual_reconciliation:state==='PARTIAL_NEEDS_RECONCILIATION',
    ...authorizations
  };
}
export async function applyCarryForwardBatch(app,raw){
  app.allow('edit');validateValue(raw);
  strict(raw,['plan','confirm_plan_sha256','confirm_source_candidate_sha256',
    'confirm_destination_build','acknowledge_create_all_drafts']);
  const plan=verifyCarryForwardBatch(app,raw.plan);
  ensure(raw.confirm_plan_sha256===plan.plan_sha256&&
    raw.confirm_source_candidate_sha256===plan.source_candidate_sha256&&
    raw.confirm_destination_build===plan.destination_build&&
    raw.acknowledge_create_all_drafts===true,
    'Re-enter exact full plan, Candidate, destination build and authorize all selected draft writes',
    'ConsentRequired');
  return withCarryForwardLock(app,async()=>{
    // Preflight ALL selected plans and existing drafts under the shared R70
    // lock before performing the first mutation. This is NOT a database-wide
    // atomic transaction; explicit partial progress is durable after failure.
    verifyCarryForwardBatch(app,plan);
    const before=inspectCarryForwardBatch(app,plan);
    let createdDocuments=0,createdRelations=0;
    for(const item of plan.plans){
      const result=await applyCarryForwardUnderLock(app,item,{
        confirm_plan_sha256:item.plan_sha256,
        confirm_source_candidate_sha256:item.source_candidate_sha256,
        confirm_destination_build:item.destination_build,
        acknowledge_create_draft:true
      });
      createdDocuments+=result.created_deliverable?1:0;
      createdRelations+=result.created_relation?1:0;
    }
    const final=inspectCarryForwardBatch(app,plan);
    ensure(final.state==='BATCH_READY',
      'Batch created partial Native drafts; reconcile same original plan',
      'Conflict');
    return{
      ...final,created_documents:createdDocuments,
      created_provenance_relations:createdRelations,
      recovered:before.state==='BATCH_READY',
      workspace_mutated:createdDocuments>0||createdRelations>0,
      all_documents_manually_review_required:true
    };
  });
}
