// SPDX-License-Identifier: AGPL-3.0-only
import { requireCondition as ensure, object, integer } from '@semwright/native-sdk';
import { digest, inputObject, str, lines, choice, array, idText } from './contracts.mjs';
import { iso } from './base.mjs';
import { validateVerification, validateWaiver } from './records.mjs';

const sameVersion=(a,b)=>!!a&&!!b&&a.generation===b.generation&&a.revision===b.revision;
const requiredDimensions=candidate=>candidate.data.manifest.review_policy?.required_verification_dimensions??candidate.data.manifest.contract?.required_verification_dimensions??[];
const REPAIR_ACTIONS=Object.freeze({
  'edit-copy':'change.propose',
  'recapture':'capture.ingest',
  'rebind-reference':'change.propose',
  'correct-crop':'media.revise',
  'update-locale':'localization.update',
  'withdraw-claim':'change.propose',
  'rerun-verifier':'verification.record'
});

function coverageState(coverage,omissions){
  if(coverage.total===0&&coverage.checked===0)return'NOT_RUN';
  if(coverage.checked===coverage.total&&omissions.length===0)return'COMPLETE';
  return'PARTIAL';
}

function expectedVerifier(candidate,dimension,profileId){
  const pins=candidate.data.manifest.verifier_profiles??[];
  const covered=pins.filter(pin=>pin.dimensions.includes(dimension));
  const required=requiredDimensions(candidate).includes(dimension);
  if(required)ensure(profileId&&covered.some(pin=>pin.id===profileId),'Required verification dimension must use a verifier profile pinned by the candidate','PolicyDenied');
  if(!profileId)return null;
  const pin=pins.find(entry=>entry.id===profileId);
  ensure(pin,'Verification profile is not pinned by this candidate','PermissionDenied');
  ensure(pin.dimensions.includes(dimension),'Verifier profile is not approved for this verification dimension','PolicyDenied');
  return pin;
}

function evaluateNegativeControls(app,releaseId,pinned,dimension,reported){
  if(!pinned){
    ensure(reported.length===0,'Negative-control outcomes require a verifier profile pinned by the candidate','PolicyDenied');
    return{state:'NOT_CONFIGURED',results:[]};
  }
  const expected=(pinned.negative_control_cases??[]).filter(control=>control.dimension===dimension);
  const byId=new Map(expected.map(control=>[control.id,control]));
  const reportedById=new Map();
  for(const result of reported){
    const control=byId.get(result.case_id);
    ensure(control,'Negative-control result is not part of the protected verifier corpus for this dimension','PermissionDenied');
    ensure(result.fixture_sha256===control.fixture_sha256,'Negative-control fixture digest differs from the protected corpus','Conflict');
    if(result.evidence_id){
      const evidence=app.get(result.evidence_id);
      ensure(app.productOf(evidence)===app.productOf(app.get(releaseId,'release')),'Negative-control evidence belongs to another product','PermissionDenied');
    }
    reportedById.set(result.case_id,result);
  }
  const results=expected.map(control=>{
    const reportedResult=reportedById.get(control.id);
    return{
      case_id:control.id,dimension:control.dimension,kind:control.kind,fixture_sha256:control.fixture_sha256,
      expected_outcome:control.expected_outcome,
      outcome:reportedResult?.outcome??'NOT_RUN',
      evidence_id:reportedResult?.evidence_id??null,
      detail:reportedResult?.detail??(reportedResult?'':'Verifier did not report this protected negative-control case'),
      report_source:reportedResult?'verifier-report':'derived-missing'
    };
  });
  if(results.length===0)return{state:'NOT_CONFIGURED',results};
  if(results.some(result=>result.outcome==='MISSED'))return{state:'FAILED',results};
  if(results.some(result=>result.outcome==='NOT_RUN'||result.outcome==='UNKNOWN'))return{state:'INCOMPLETE',results};
  return{state:'COMPLETE',results};
}

export function recordVerification(app,input){
  const data=validateVerification(input),candidate=app.get(data.candidate_id,'candidate');
  ensure(data.candidate_sha256===candidate.data.candidate_sha256,'Verification candidate digest mismatch','Conflict');

  const artifactPins=new Map((candidate.data.manifest.artifacts??[]).map(entry=>[entry.id,entry]));
  const artifactBindings=data.artifact_ids.map(id=>{
    const pin=artifactPins.get(id);
    ensure(pin,'Verification references bytes outside the candidate','PermissionDenied');
    const artifact=app.get(id,'artifact');
    ensure(sameVersion(artifact.version,pin.version)&&artifact.data.sha256===pin.sha256,'Verification artifact differs from the frozen candidate','StaleReference');
    app.store.readBlob(pin.sha256);
    return{id:pin.id,version:pin.version,sha256:pin.sha256,mime:pin.mime,target_id:pin.target_id};
  });

  let targetBinding=null;
  if(data.target_id){
    const pin=(candidate.data.manifest.target_contexts??[]).find(entry=>entry.id===data.target_id);
    ensure(pin,'Verification target is not represented by candidate outputs','PermissionDenied');
    const target=app.get(data.target_id,'target');
    ensure(sameVersion(target.version,pin.version),'Verification target context changed after candidate freeze','StaleReference');
    targetBinding={id:pin.id,version:pin.version,fingerprint_sha256:pin.fingerprint_sha256};
  }

  const pinned=expectedVerifier(candidate,data.dimension,data.verifier_profile_id);
  let profileBinding=null;
  if(pinned){
    const profile=app.get(pinned.id,'extension_package');
    ensure(profile.data.type==='verifier_profile','Pinned verification resource is not a verifier profile','Conflict');
    ensure(profile.data.status==='active','Pinned verifier profile is retired','StaleReference');
    ensure(sameVersion(profile.version,pinned.version),'Pinned verifier profile revision changed','StaleReference');
    ensure(profile.data.digest===pinned.digest&&profile.data.package_version===pinned.package_version,'Pinned verifier profile bytes/version changed','StaleReference');
    ensure(data.verifier.id===pinned.name,'Verifier identity does not match the protected profile','PolicyDenied');
    ensure(data.verifier.version===pinned.package_version,'Verifier version does not match the protected profile','PolicyDenied');
    ensure(data.verifier.digest===pinned.digest,'Verifier digest does not match the protected profile','PolicyDenied');
    ensure(data.verifier.authority===pinned.authority,'Verifier authority does not match the protected profile','PolicyDenied');
    if(pinned.model!==null)ensure(data.verifier.model===pinned.model,'Verifier model does not match the protected profile','PolicyDenied');
    profileBinding=pinned;
  }

  if(data.verifier.authority==='canonical')ensure(app.capabilities.canonical_verifier_admission===true,'Canonical verifier admission is unavailable in this session','PolicyDenied');
  const admission=data.verifier.authority==='canonical'?'canonical-owner-admitted':data.verifier.authority==='heuristic'?'heuristic-report':'local-review-record';
  const coverage_state=coverageState(data.coverage,data.omissions);
  const controls=evaluateNegativeControls(app,candidate.data.release_id,profileBinding,data.dimension,data.negative_control_results);
  const context={
    candidate_id:candidate.id,candidate_sha256:candidate.data.candidate_sha256,candidate_version:candidate.version,
    dimension:data.dimension,artifact_bindings:artifactBindings,target_binding:targetBinding,verifier_profile:profileBinding,
    verifier:data.verifier,coverage:data.coverage,omissions:data.omissions,negative_control_state:controls.state,
    negative_control_results:controls.results
  };
  return{entity:app.store.create('verification',{
    release_id:candidate.data.release_id,name:data.dimension+' verification',...data,
    candidate_version:candidate.version,artifact_bindings:artifactBindings,target_binding:targetBinding,
    verifier_profile:profileBinding,coverage_state,negative_control_state:controls.state,negative_control_results:controls.results,
    report_context_sha256:digest('verification-context-v2',context),
    admission,recorded_by:app.principal,recorded_at:iso()
  })};
}

function verificationBindingState(app,candidate,record){
  const reasons=[];
  if(record.data.candidate_sha256!==candidate.data.candidate_sha256)reasons.push('candidate-digest-mismatch');
  if(!sameVersion(record.data.candidate_version,candidate.version))reasons.push('candidate-version-mismatch');

  const candidateArtifacts=new Map((candidate.data.manifest.artifacts??[]).map(entry=>[entry.id,entry]));
  for(const binding of record.data.artifact_bindings??[]){
    const pin=candidateArtifacts.get(binding.id);
    if(!pin||pin.sha256!==binding.sha256||!sameVersion(pin.version,binding.version))reasons.push('artifact-binding-mismatch:'+binding.id);
    else{
      try{app.store.readBlob(binding.sha256);}catch{reasons.push('artifact-bytes-unavailable:'+binding.id);}
    }
  }
  if((record.data.artifact_bindings??[]).length!==record.data.artifact_ids.length)reasons.push('artifact-binding-incomplete');

  if(record.data.target_binding){
    const pin=(candidate.data.manifest.target_contexts??[]).find(entry=>entry.id===record.data.target_binding.id);
    if(!pin||pin.fingerprint_sha256!==record.data.target_binding.fingerprint_sha256||!sameVersion(pin.version,record.data.target_binding.version))reasons.push('target-binding-mismatch');
  }

  const required=requiredDimensions(candidate).includes(record.data.dimension);
  const pinned=record.data.verifier_profile;
  if(required&&!pinned)reasons.push('required-verifier-profile-unpinned');
  if(pinned){
    const manifestPin=(candidate.data.manifest.verifier_profiles??[]).find(entry=>entry.id===pinned.id);
    if(!manifestPin||manifestPin.digest!==pinned.digest||!sameVersion(manifestPin.version,pinned.version))reasons.push('verifier-profile-candidate-mismatch');
    try{
      const current=app.get(pinned.id,'extension_package');
      if(current.data.status!=='active'||current.data.digest!==pinned.digest||!sameVersion(current.version,pinned.version))reasons.push('verifier-profile-stale');
    }catch{reasons.push('verifier-profile-missing');}
  }

  const coverage_state=record.data.coverage_state??coverageState(record.data.coverage,record.data.omissions);
  const negative_control_state=record.data.negative_control_state??(pinned?.negative_controls?'INCOMPLETE':'NOT_CONFIGURED');
  if(record.data.state==='PASS'&&coverage_state!=='COMPLETE')reasons.push('verification-coverage-incomplete');
  if(required&&negative_control_state!=='COMPLETE')reasons.push(negative_control_state==='FAILED'?'negative-control-missed':'negative-controls-incomplete');
  return{current:reasons.length===0,reasons,coverage_state,negative_control_state};
}

function nextAction(record,binding,effective){
  if(effective==='PASS')return'none';
  if(binding.negative_control_state==='FAILED')return'repair-or-replace-verifier-negative-control-miss';
  if(binding.negative_control_state==='INCOMPLETE')return'run-missing-negative-controls';
  if(record.data.state==='FAIL')return'repair-or-request-scoped-waiver';
  if(record.data.state==='ERROR')return'diagnose-verifier-before-rerun';
  if(binding.coverage_state!=='COMPLETE')return'complete-verification-coverage';
  if(binding.reasons.some(reason=>reason.includes('verifier-profile')))return'freeze-new-candidate-with-approved-verifier';
  if(binding.reasons.length)return'freeze-new-candidate-after-context-drift';
  return'obtain-canonical-verifier-admission';
}

function repairProjection(repair){
  return{
    id:repair.id,version:repair.version,state:repair.data.state,action:repair.data.action,subject_id:repair.data.subject_id,
    budget:repair.data.budget,attempts_used:repair.data.attempts_used,runtime_seconds_used:repair.data.runtime_seconds_used,
    cost_microunits_used:repair.data.cost_microunits_used,budget_breached:repair.data.budget_breached,
    candidate_rebuild_required:repair.data.candidate_rebuild_required,next_operation:repair.data.next_operation,
    next_action:repair.data.next_action,attempts:repair.data.attempts
  };
}

export function verificationSummary(app,candidateId){
  const candidate=app.get(candidateId,'candidate');
  const records=app.list('verification',candidate.data.release_id).filter(v=>v.data.candidate_id===candidate.id);
  const waivers=app.list('waiver',candidate.data.release_id).filter(w=>w.data.candidate_id===candidate.id);
  const repairs=app.list('verification_repair',candidate.data.release_id).filter(repair=>repair.data.candidate_id===candidate.id);
  const checks=records.map(v=>{
    const related=waivers.filter(w=>w.data.verification_id===v.id),active=related.filter(w=>!w.data.expires_at||Date.parse(w.data.expires_at)>Date.now());
    const binding=verificationBindingState(app,candidate,v);
    const admitted=v.data.admission==='canonical-owner-admitted';
    const effective=v.data.state==='FAIL'||v.data.state==='ERROR'?v.data.state:
      binding.negative_control_state==='FAILED'?'ERROR':
      (v.data.state==='PASS'&&admitted&&binding.current?'PASS':'UNKNOWN');
    return{
      verification_id:v.id,dimension:v.data.dimension,reported_state:v.data.state,effective_state:effective,
      admission:v.data.admission,verifier:v.data.verifier,verifier_profile:v.data.verifier_profile??null,
      candidate_sha256:v.data.candidate_sha256,report_context_sha256:v.data.report_context_sha256??null,
      artifact_bindings:v.data.artifact_bindings??[],target_binding:v.data.target_binding??null,
      coverage:v.data.coverage,coverage_state:binding.coverage_state,omissions:v.data.omissions,findings:v.data.findings,
      negative_control_state:binding.negative_control_state,negative_control_results:v.data.negative_control_results??[],
      binding_current:binding.current,binding_reasons:binding.reasons,next_action:nextAction(v,binding,effective),
      repairs:repairs.filter(repair=>repair.data.verification_id===v.id).map(repairProjection),
      waivers:related.map(w=>({id:w.id,scope:w.data.scope,expires_at:w.data.expires_at??null,active:active.some(a=>a.id===w.id)})),waived:active.length>0
    };
  });
  const state=checks.some(c=>['FAIL','ERROR'].includes(c.effective_state))?'FAIL':checks.length&&checks.every(c=>c.effective_state==='PASS')?'PASS':'UNKNOWN';
  return{
    candidate_id:candidate.id,candidate_sha256:candidate.data.candidate_sha256,state,checks,
    canonical_passes:checks.filter(c=>c.effective_state==='PASS').length,
    failures:checks.filter(c=>['FAIL','ERROR'].includes(c.effective_state)).length,
    unknown:checks.filter(c=>c.effective_state==='UNKNOWN').length,
    note:'Waivers preserve underlying verification truth. PASS requires canonical admission, exact candidate/bytes/context bindings, complete declared coverage, and complete protected negative-control execution for required dimensions.'
  };
}

function boundedRepairBudget(raw){
  object(raw,['max_attempts','max_runtime_seconds','max_cost_microunits','currency'],['max_attempts','max_runtime_seconds','max_cost_microunits','currency']);
  integer(raw.max_attempts,1,20);integer(raw.max_runtime_seconds,1,86400);integer(raw.max_cost_microunits,0,1000000000);str(raw.currency,8);
  ensure(/^[A-Z]{3,8}$/.test(raw.currency),'Repair budget currency must be an uppercase currency/unit code');
  return structuredClone(raw);
}

export function prepareVerificationRepair(app,input){
  inputObject(input,['verification_id','name','action','subject_id','reason','budget'],['verification_id','name','action','subject_id','reason','budget']);
  idText(input.verification_id);idText(input.subject_id);str(input.name,160);choice(input.action,Object.keys(REPAIR_ACTIONS));lines(input.reason,4000);
  const verification=app.get(input.verification_id,'verification'),candidate=app.get(verification.data.candidate_id,'candidate'),release=app.get(candidate.data.release_id,'release');
  const check=verificationSummary(app,candidate.id).checks.find(item=>item.verification_id===verification.id);
  ensure(check&&check.effective_state!=='PASS','Passing verification does not need repair','InvalidArgument');
  const subject=app.get(input.subject_id);
  ensure(app.productOf(subject)===release.data.product_id,'Repair subject belongs to another product','PermissionDenied');
  const budget=boundedRepairBudget(input.budget);
  return{entity:app.store.create('verification_repair',{
    release_id:release.id,name:input.name,verification_id:verification.id,candidate_id:candidate.id,candidate_sha256:candidate.data.candidate_sha256,
    verification_context_sha256:verification.data.report_context_sha256??null,action:input.action,subject_id:subject.id,subject_version_at_prepare:subject.version,
    reason:input.reason,budget,attempts_used:0,runtime_seconds_used:0,cost_microunits_used:0,attempts:[],state:'PREPARED',
    budget_breached:false,budget_enforcement:'launchwright-recording-boundary',execution_authority:false,
    candidate_rebuild_required:input.action!=='rerun-verifier',next_operation:REPAIR_ACTIONS[input.action],
    next_action:'execute-first-bounded-repair-attempt',prepared_by:app.principal,prepared_at:iso()
  })};
}

export function recordVerificationRepairAttempt(app,input){
  inputObject(input,['id','expected','outcome','runtime_seconds','cost_microunits','evidence_ids','detail'],['id','expected','outcome','runtime_seconds','cost_microunits','evidence_ids']);
  idText(input.id);object(input.expected,['resource','generation','revision'],['resource','generation','revision']);
  choice(input.outcome,['SUCCEEDED','FAILED','UNKNOWN','ERROR']);integer(input.runtime_seconds,0,86400);integer(input.cost_microunits,0,1000000000);
  array(input.evidence_ids,32).forEach(idText);ensure(new Set(input.evidence_ids).size===input.evidence_ids.length,'Duplicate repair evidence reference');
  if(input.detail!==undefined)lines(input.detail,4000);
  const repair=app.get(input.id,'verification_repair');ensure(sameVersion(repair.version,input.expected),'Repair revision changed','StaleReference');
  ensure(['PREPARED','IN_PROGRESS'].includes(repair.data.state),'Repair budget is already terminal; prepare a new repair instead','Conflict');
  const budget=repair.data.budget;
  ensure(repair.data.attempts_used<budget.max_attempts,'Repair attempt budget is exhausted','ResourceExhausted');
  ensure(repair.data.runtime_seconds_used<budget.max_runtime_seconds,'Repair runtime budget is exhausted','ResourceExhausted');
  if(budget.max_cost_microunits>0)ensure(repair.data.cost_microunits_used<budget.max_cost_microunits,'Repair cost budget is exhausted','ResourceExhausted');
  const candidate=app.get(repair.data.candidate_id,'candidate'),release=app.get(candidate.data.release_id,'release');
  for(const id of input.evidence_ids){
    const evidence=app.get(id);
    ensure(app.productOf(evidence)===release.data.product_id,'Repair evidence belongs to another product','PermissionDenied');
  }
  const attempts_used=repair.data.attempts_used+1;
  const runtime_seconds_used=repair.data.runtime_seconds_used+input.runtime_seconds;
  const cost_microunits_used=repair.data.cost_microunits_used+input.cost_microunits;
  const budget_breached=runtime_seconds_used>budget.max_runtime_seconds||cost_microunits_used>budget.max_cost_microunits;
  const exhausted=budget_breached||attempts_used>=budget.max_attempts||runtime_seconds_used>=budget.max_runtime_seconds||
    (budget.max_cost_microunits>0&&cost_microunits_used>=budget.max_cost_microunits);
  const attempt={
    index:attempts_used,outcome:input.outcome,runtime_seconds:input.runtime_seconds,cost_microunits:input.cost_microunits,
    evidence_ids:[...input.evidence_ids],detail:input.detail??'',budget_breached,recorded_by:app.principal,recorded_at:iso()
  };
  const state=budget_breached?'EXHAUSTED':input.outcome==='SUCCEEDED'?'SUCCEEDED':exhausted?'EXHAUSTED':'IN_PROGRESS';
  const next_action=state==='SUCCEEDED'?(repair.data.candidate_rebuild_required?'freeze-new-candidate-and-reverify':'record-new-verification'):
    state==='EXHAUSTED'?'manual-review-or-scoped-waiver':'execute-next-bounded-repair-attempt';
  const subject=app.get(repair.data.subject_id);
  return{entity:app.store.update(repair.id,{
    ...repair.data,attempts_used,runtime_seconds_used,cost_microunits_used,
    attempts:[...repair.data.attempts,attempt],state,budget_breached:repair.data.budget_breached||budget_breached,
    subject_version_observed:subject.version,next_action,last_attempt_at:attempt.recorded_at
  })};
}

export function recordWaiver(app,input){
  const data=validateWaiver(input),candidate=app.get(data.candidate_id,'candidate'),verification=app.get(data.verification_id,'verification');
  ensure(verification.data.candidate_id===candidate.id&&verification.data.release_id===candidate.data.release_id,'Waiver verification belongs to another candidate','PermissionDenied');
  ensure(verification.data.state!=='PASS','A passing verification does not need a waiver','InvalidArgument');
  if(data.expires_at)ensure(Date.parse(data.expires_at)>Date.now(),'Waiver is already expired','InvalidArgument');
  return{entity:app.store.create('waiver',{
    release_id:candidate.data.release_id,name:'Waiver · '+verification.data.dimension,...data,
    author:app.principal,underlying_state:verification.data.state,created_at:iso(),changes_verification_state:false
  })};
}
