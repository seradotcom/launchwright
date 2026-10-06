// SPDX-License-Identifier: AGPL-3.0-only
import { requireCondition as ensure } from '@semwright/native-sdk';
import { digest } from './contracts.mjs';
import { iso } from './base.mjs';
import { validateVerification, validateWaiver } from './records.mjs';

const sameVersion=(a,b)=>!!a&&!!b&&a.generation===b.generation&&a.revision===b.revision;
const requiredDimensions=candidate=>candidate.data.manifest.review_policy?.required_verification_dimensions??candidate.data.manifest.contract?.required_verification_dimensions??[];

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
  const context={
    candidate_id:candidate.id,candidate_sha256:candidate.data.candidate_sha256,candidate_version:candidate.version,
    dimension:data.dimension,artifact_bindings:artifactBindings,target_binding:targetBinding,verifier_profile:profileBinding,
    verifier:data.verifier,coverage:data.coverage,omissions:data.omissions
  };
  return{entity:app.store.create('verification',{
    release_id:candidate.data.release_id,name:data.dimension+' verification',...data,
    candidate_version:candidate.version,artifact_bindings:artifactBindings,target_binding:targetBinding,
    verifier_profile:profileBinding,coverage_state,report_context_sha256:digest('verification-context-v1',context),
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
  if(record.data.state==='PASS'&&coverage_state!=='COMPLETE')reasons.push('verification-coverage-incomplete');
  return{current:reasons.length===0,reasons,coverage_state};
}

function nextAction(record,binding,effective){
  if(effective==='PASS')return'none';
  if(record.data.state==='FAIL')return'repair-or-request-scoped-waiver';
  if(record.data.state==='ERROR')return'diagnose-verifier-before-rerun';
  if(binding.coverage_state!=='COMPLETE')return'complete-verification-coverage';
  if(binding.reasons.some(reason=>reason.includes('verifier-profile')))return'freeze-new-candidate-with-approved-verifier';
  if(binding.reasons.length)return'freeze-new-candidate-after-context-drift';
  return'obtain-canonical-verifier-admission';
}

export function verificationSummary(app,candidateId){
  const candidate=app.get(candidateId,'candidate');
  const records=app.list('verification',candidate.data.release_id).filter(v=>v.data.candidate_id===candidate.id);
  const waivers=app.list('waiver',candidate.data.release_id).filter(w=>w.data.candidate_id===candidate.id);
  const checks=records.map(v=>{
    const related=waivers.filter(w=>w.data.verification_id===v.id),active=related.filter(w=>!w.data.expires_at||Date.parse(w.data.expires_at)>Date.now());
    const binding=verificationBindingState(app,candidate,v);
    const admitted=v.data.admission==='canonical-owner-admitted';
    const effective=v.data.state==='FAIL'||v.data.state==='ERROR'?v.data.state:(v.data.state==='PASS'&&admitted&&binding.current?'PASS':'UNKNOWN');
    return{
      verification_id:v.id,dimension:v.data.dimension,reported_state:v.data.state,effective_state:effective,
      admission:v.data.admission,verifier:v.data.verifier,verifier_profile:v.data.verifier_profile??null,
      candidate_sha256:v.data.candidate_sha256,report_context_sha256:v.data.report_context_sha256??null,
      artifact_bindings:v.data.artifact_bindings??[],target_binding:v.data.target_binding??null,
      coverage:v.data.coverage,coverage_state:binding.coverage_state,omissions:v.data.omissions,findings:v.data.findings,
      binding_current:binding.current,binding_reasons:binding.reasons,next_action:nextAction(v,binding,effective),
      waivers:related.map(w=>({id:w.id,scope:w.data.scope,expires_at:w.data.expires_at??null,active:active.some(a=>a.id===w.id)})),waived:active.length>0
    };
  });
  const state=checks.some(c=>['FAIL','ERROR'].includes(c.effective_state))?'FAIL':checks.length&&checks.every(c=>c.effective_state==='PASS')?'PASS':'UNKNOWN';
  return{
    candidate_id:candidate.id,candidate_sha256:candidate.data.candidate_sha256,state,checks,
    canonical_passes:checks.filter(c=>c.effective_state==='PASS').length,
    failures:checks.filter(c=>['FAIL','ERROR'].includes(c.effective_state)).length,
    unknown:checks.filter(c=>c.effective_state==='UNKNOWN').length,
    note:'Waivers preserve underlying verification truth. PASS requires canonical admission, exact candidate/bytes/context bindings, a current protected verifier profile when required, and complete declared coverage.'
  };
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
