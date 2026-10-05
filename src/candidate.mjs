// SPDX-License-Identifier: AGPL-3.0-only
import { requireCondition as ensure, object, integer } from '@semwright/native-sdk';
import { inputObject, str, array, choice, lines, sha, digest, iso } from './contracts.mjs';
import { assessLocalization } from './localization.mjs';

const VERIFICATION_DIMENSIONS=['format','semantic','editorial','privacy','rights','accessibility','product-evidence','permissions'];
const pin=entity=>({id:entity.id,kind:entity.kind,version:entity.version});

function uniqueIds(value,max,label){
  const ids=value??[];array(ids,max);ensure(new Set(ids).size===ids.length,'Duplicate '+label);return ids;
}

function normalizedReviewPolicy(raw){
  object(raw,
    ['version','required_reviewers','require_claims_verified','required_verification_dimensions','allow_partial_delivery'],
    ['version','required_reviewers','require_claims_verified']);
  str(raw.version,64);integer(raw.required_reviewers,1,8);
  ensure(typeof raw.require_claims_verified==='boolean','Contract requires an explicit claims policy');
  const dimensions=raw.required_verification_dimensions??[];
  array(dimensions,VERIFICATION_DIMENSIONS.length);
  dimensions.forEach(d=>choice(d,VERIFICATION_DIMENSIONS));
  ensure(new Set(dimensions).size===dimensions.length,'Duplicate required verification dimension');
  if(raw.allow_partial_delivery!==undefined)ensure(typeof raw.allow_partial_delivery==='boolean','allow_partial_delivery must be boolean');
  return{
    version:raw.version,
    required_reviewers:raw.required_reviewers,
    require_claims_verified:raw.require_claims_verified,
    required_verification_dimensions:[...dimensions].sort(),
    allow_partial_delivery:raw.allow_partial_delivery===true
  };
}

export function freezeCandidate(app,input){
  inputObject(input,
    ['release_id','name','artifact_ids','destination','contract','release_contract_id','localized_copy_ids','channel_profile_ids','rights_evidence_ids'],
    ['release_id','name','artifact_ids','destination','contract']);
  const release=app.get(input.release_id,'release');str(input.name,160);str(input.destination,96);
  ensure(/^[a-z0-9][a-z0-9_-]{0,95}$/.test(input.destination),'Destination must be a local alias identifier');
  const artifactIds=uniqueIds(input.artifact_ids,32,'candidate artifacts');
  ensure(artifactIds.length>0,'Candidate requires at least one artifact');
  const localizationIds=uniqueIds(input.localized_copy_ids,64,'candidate localizations');
  const channelProfileIds=uniqueIds(input.channel_profile_ids,32,'candidate channel profiles');
  const explicitRightsIds=uniqueIds(input.rights_evidence_ids,128,'candidate rights evidence');
  const reviewPolicy=normalizedReviewPolicy(input.contract);

  const artifacts=artifactIds.map(id=>app.get(id,'artifact'));
  const inputs=new Map(),claimIds=new Set(),targetIds=new Set(),evidenceIds=new Set(explicitRightsIds);
  for(const artifact of artifacts){
    ensure(artifact.data.release_id===release.id,'Candidate artifact belongs to another release');
    ensure(app.freshness(artifact.data.inputs).length===0,'An artifact has changed inputs; render a new version','StaleReference');
    app.store.readBlob(artifact.data.sha256);
    targetIds.add(artifact.data.target_id);
    for(const dependency of artifact.data.inputs){
      inputs.set(dependency.id,dependency);
      if(dependency.kind==='claim')claimIds.add(dependency.id);
      if(dependency.kind==='evidence')evidenceIds.add(dependency.id);
    }
  }

  const targets=[...targetIds].sort().map(id=>{
    const target=app.get(id,'target');ensure(target.data.release_id===release.id,'Candidate target belongs to another release');
    inputs.set(target.id,pin(target));
    return{id:target.id,version:target.version,fingerprint_sha256:digest('target-context',{version:target.version,data:target.data})};
  });

  let releaseContract=null;
  if(input.release_contract_id){
    const contract=app.get(input.release_contract_id,'release_contract');
    ensure(contract.data.release_id===release.id,'ReleaseContract belongs to another release','PermissionDenied');
    inputs.set(contract.id,pin(contract));
    releaseContract={id:contract.id,version:contract.version};
  }

  const localizations=localizationIds.map(id=>{
    const localized=app.get(id,'localized_copy');
    ensure(localized.data.release_id===release.id,'Localization belongs to another release','PermissionDenied');
    ensure(targetIds.has(localized.data.target_id),'Localization target is not represented by candidate artifacts','PermissionDenied');
    inputs.set(localized.id,pin(localized));
    const source=app.get(localized.data.source_copy_block_id,'copy_block');inputs.set(source.id,pin(source));
    if(localized.data.glossary_id){const glossary=app.get(localized.data.glossary_id,'glossary');inputs.set(glossary.id,pin(glossary));}
    const assessment=assessLocalization(app,localized);
    return{id:localized.id,version:localized.version,target_id:localized.data.target_id,locale:localized.data.locale,direction:localized.data.direction,assessment_state:assessment.state};
  }).sort((a,b)=>a.id.localeCompare(b.id));

  const channelProfiles=channelProfileIds.map(id=>{
    const profile=app.get(id,'channel_profile');
    ensure(profile.data.product_id===release.data.product_id,'Channel profile belongs to another product','PermissionDenied');
    inputs.set(profile.id,pin(profile));
    return{id:profile.id,version:profile.version,profile_version:profile.data.profile_version,channel:profile.data.channel,destination_class:profile.data.destination_class,effective_at:profile.data.effective_at};
  }).sort((a,b)=>a.id.localeCompare(b.id));

  const rights=[...evidenceIds].sort().map(id=>{
    const evidence=app.get(id,'evidence');
    ensure(evidence.data.release_id===release.id,'Rights evidence belongs to another release','PermissionDenied');
    inputs.set(evidence.id,pin(evidence));
    return{id:evidence.id,version:evidence.version,rights:evidence.data.rights,classification:evidence.data.classification,admission:evidence.data.admission,rights_basis:evidence.data.rights_basis??'unknown'};
  });

  inputs.set(release.id,pin(release));
  const manifest={
    schema_version:'launchwright-candidate/2',
    release_id:release.id,
    release_version:release.version,
    base_workspace_version:app.store.version(),
    artifact_ids:[...artifactIds].sort(),
    artifacts:artifacts.map(a=>({id:a.id,version:a.version,sha256:a.data.sha256,bytes:a.data.size_bytes,target_id:a.data.target_id,deliverable_id:a.data.deliverable_id})).sort((a,b)=>a.id.localeCompare(b.id)),
    target_contexts:targets,
    inputs:[...inputs.values()].sort((a,b)=>a.id.localeCompare(b.id)),
    claim_ids:[...claimIds].sort(),
    release_contract:releaseContract,
    localizations,
    channel_profiles:channelProfiles,
    rights,
    destination:input.destination,
    review_policy:reviewPolicy,
    contract:reviewPolicy
  };
  const hash=digest('candidate',manifest);
  return{entity:app.store.create('candidate',{release_id:release.id,name:input.name,manifest,candidate_sha256:hash,frozen_at:iso(),publication_class:'private-draft-only'})};
}

export function candidateProtectedGates(app,candidate){
  const manifest=candidate.data.manifest;
  const gates=[];
  if(manifest.release_contract){
    let contractState='PASS',details=[];
    try{
      const current=app.get(manifest.release_contract.id,'release_contract');
      if(current.version.generation!==manifest.release_contract.version.generation||current.version.revision!==manifest.release_contract.version.revision){
        contractState='FAIL';details=[{reason:'release-contract-revision-changed',expected:manifest.release_contract.version,observed:current.version}];
      }
    }catch{contractState='FAIL';details=[{reason:'release-contract-missing'}];}
    gates.push({name:'release-contract',state:contractState,details});
  }else gates.push({name:'release-contract',state:'UNKNOWN',details:['Candidate is not pinned to a ReleaseContract.']});

  if(manifest.localizations?.length){
    const details=manifest.localizations.map(entry=>{
      const entity=app.get(entry.id,'localized_copy');const assessment=assessLocalization(app,entity);
      return{id:entry.id,locale:entry.locale,state:assessment.state,reasons:assessment.reasons,warnings:assessment.warnings,final_layout_verified:assessment.final_layout_verified,professional_language_quality_verified:assessment.professional_language_quality_verified};
    });
    const failed=details.some(x=>['FAIL','STALE_SOURCE'].includes(x.state));
    gates.push({name:'localization',state:failed?'FAIL':'UNKNOWN',details});
  }else gates.push({name:'localization',state:'UNKNOWN',details:['No localized copy is protected by this candidate.']});

  if(manifest.channel_profiles?.length){
    gates.push({name:'channel-profiles',state:'PASS',details:manifest.channel_profiles});
  }else gates.push({name:'channel-profiles',state:'UNKNOWN',details:['No channel profile is protected by this candidate.']});

  if(manifest.rights?.length){
    const restricted=manifest.rights.filter(r=>r.rights==='restricted');
    const unknown=manifest.rights.filter(r=>r.rights==='unknown'||!['owned','licensed','restricted'].includes(r.rights));
    gates.push({name:'declared-rights',state:restricted.length?'FAIL':unknown.length?'UNKNOWN':'PASS',details:manifest.rights});
  }else gates.push({name:'declared-rights',state:'UNKNOWN',details:['No rights evidence is protected by this candidate.']});
  return gates;
}

export function editorialReviewState(candidate,reviews){
  const latest=new Map();
  for(const review of [...reviews].sort((a,b)=>BigInt(a.data.decision_order)<BigInt(b.data.decision_order)?-1:1))latest.set(review.data.reviewer,review);
  const decisions=[...latest.values()];
  if(decisions.some(r=>r.data.decision==='reject'||r.data.decision==='request-changes'))return{state:'BLOCKED',approvals:decisions.filter(r=>r.data.decision==='approve-editorial').length,latest:decisions};
  const required=candidate.data.manifest.review_policy?.required_reviewers??candidate.data.manifest.contract?.required_reviewers??1;
  const approvals=decisions.filter(r=>r.data.decision==='approve-editorial').length;
  return{state:approvals>=required?'APPROVED_EDITORIAL':'PENDING',approvals,required,latest:decisions};
}

export function recordCandidateReview(app,input){
  inputObject(input,['id','candidate_sha256','decision','comment']);
  const candidate=app.get(input.id,'candidate');sha(input.candidate_sha256);
  ensure(candidate.data.candidate_sha256===input.candidate_sha256,'Review candidate digest mismatch','Conflict');
  choice(input.decision,['approve-editorial','request-changes','reject']);lines(input.comment,8000);
  const inspected=inspectCandidateState(app,candidate);
  ensure(inspected.readiness.review==='READY_FOR_REVIEW','Candidate bytes or protected inputs changed; freeze a new candidate before review','StaleReference');
  return{entity:app.store.create('review',{
    release_id:candidate.data.release_id,name:`${input.decision} · ${app.principal}`,
    candidate_id:candidate.id,candidate_sha256:candidate.data.candidate_sha256,
    decision:input.decision,comment:input.comment,decision_order:app.store.version().revision,
    reviewer:app.principal,authority:'local-editorial-only',technical_waiver:false
  })};
}

export function assertPrivateDeliveryReady(candidate,checked){
  ensure(checked.private_draft_allowed,'Candidate has stale inputs or invalid bytes','StaleReference');
  ensure(checked.editorial_review.state==='APPROVED_EDITORIAL','Required editorial reviews are missing or request changes','PermissionDenied');
  if(candidate.data.manifest.review_policy?.require_claims_verified??candidate.data.manifest.contract?.require_claims_verified){
    ensure(checked.gates.find(g=>g.name==='technical-claims')?.state==='PASS','Candidate policy requires verified claims before private delivery','PolicyDenied');
  }
}

export function assertChannelPinned(candidate,profile){
  const profiles=candidate.data.manifest.channel_profiles??[];
  ensure(profiles.some(entry=>entry.id===profile.id&&entry.version.generation===profile.version.generation&&entry.version.revision===profile.version.revision),
    'Channel profile is not pinned by this candidate; freeze a new candidate before packaging','StaleReference');
}

export function assertPartialDeliveryPolicy(candidate,allowPartial){
  if(allowPartial)ensure(candidate.data.manifest.review_policy?.allow_partial_delivery===true,
    'Candidate review policy does not authorize partial channel delivery','ConsentRequired');
}

export function buildCandidateGates(app,candidate){
  const changed=app.freshness(candidate.data.manifest.inputs);
  const gates=[{name:'input-versions',state:changed.length?'FAIL':'PASS',details:changed},{name:'artifact-bytes',state:'PASS',details:[]}];
  for(const id of candidate.data.manifest.artifact_ids){
    const artifact=app.get(id,'artifact');
    try{app.store.readBlob(artifact.data.sha256);}catch{gates[1].state='FAIL';gates[1].details.push(id);}
  }
  const claims=candidate.data.manifest.claim_ids.map(id=>app.claimCheck(app.get(id,'claim')));
  gates.push({name:'technical-claims',state:claims.length?'UNKNOWN':'PASS',details:claims});
  const verification=app.verificationSummary(candidate.id);
  const required=candidate.data.manifest.review_policy?.required_verification_dimensions??[];
  const requiredChecks=required.map(dimension=>{
    const matches=verification.checks.filter(check=>check.dimension===dimension);
    const state=matches.some(check=>['FAIL','ERROR'].includes(check.effective_state))?'FAIL':matches.some(check=>check.effective_state==='PASS')?'PASS':'UNKNOWN';
    return{dimension,state,records:matches.map(check=>check.verification_id)};
  });
  const requiredState=requiredChecks.some(check=>check.state==='FAIL')?'FAIL':requiredChecks.length&&requiredChecks.every(check=>check.state==='PASS')?'PASS':'UNKNOWN';
  gates.push({name:'verification-records',state:required.length?requiredState:verification.state,details:{required:requiredChecks,all:verification.checks}});
  gates.push(...candidateProtectedGates(app,candidate));
  const captures=app.list('evidence',candidate.data.release_id).filter(e=>e.data.evidence_type==='capture');
  gates.push({name:'external-capture-coverage',state:'UNKNOWN',details:captures.length?captures.map(e=>({id:e.id,capture_state:e.data.capture_state,admission:e.data.admission,host_acceptance:e.data.host_acceptance})):['No admitted capture receipt is registered for this release.']});
  return gates;
}

export function inspectCandidateState(app,candidate){
  const gates=buildCandidateGates(app,candidate),reviews=app.list('review',candidate.data.release_id).filter(r=>r.data.candidate_id===candidate.id);
  const editorial=editorialReviewState(candidate,reviews),inputGate=gates.find(g=>g.name==='input-versions'),bytesGate=gates.find(g=>g.name==='artifact-bytes');
  const technicalState=gates.some(g=>g.state==='FAIL')?'FAIL':gates.every(g=>g.state==='PASS')?'PASS':'UNKNOWN';
  const reviewReady=inputGate?.state==='PASS'&&bytesGate?.state==='PASS';
  const channelReady=technicalState==='PASS'&&editorial.state==='APPROVED_EDITORIAL'&&gates.find(g=>g.name==='channel-profiles')?.state==='PASS'&&gates.find(g=>g.name==='declared-rights')?.state==='PASS';
  return{candidate,gates,reviews,editorial_review:editorial,
    readiness:{review:reviewReady?'READY_FOR_REVIEW':'BLOCKED',editorial:editorial.state,channel:channelReady?'READY_FOR_CHANNEL_DRAFT':technicalState==='FAIL'?'BLOCKED':'UNKNOWN',published:'NOT_OBSERVED'},
    fresh:inputGate?.state!=='FAIL',
    external_publication_allowed:gates.every(g=>g.state==='PASS')&&editorial.state==='APPROVED_EDITORIAL'&&app.capabilities.canonical_publish_receipts===true,
    private_draft_allowed:!gates.some(g=>g.state==='FAIL'),
    technical_state:technicalState};
}
