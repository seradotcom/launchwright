// SPDX-License-Identifier: AGPL-3.0-only
import { object, integer, validateValue, requireCondition as ensure } from '@semwright/native-sdk';
import { idText, str, lines, array, choice, sha, noSecrets, iso } from './contracts.mjs';

const timestamp = (value, label) => {
  str(value,64);
  ensure(Number.isFinite(Date.parse(value)), label + ' must be an ISO timestamp');
  return value;
};

export function validateCapture(raw) {
  validateValue(raw); noSecrets(raw); const d=structuredClone(raw);
  object(d,
    ['release_id','target_id','source_id','scenario_id','name','build','classification','rights','started_at','finished_at','receipt','readiness','anchors','isolation','cleanup','provenance','observations','segments'],
    ['release_id','target_id','source_id','scenario_id','name','build','classification','rights','started_at','finished_at','receipt','readiness','anchors','isolation','cleanup','provenance','observations']);
  for(const k of ['release_id','target_id','source_id','scenario_id']) idText(d[k]);
  str(d.name,160); str(d.build,256);
  choice(d.classification,['actual','demo','sanitized','editorial','generated','imported']);
  choice(d.rights,['owned','licensed','unknown','restricted']);
  timestamp(d.started_at,'Capture started_at'); timestamp(d.finished_at,'Capture finished_at');
  ensure(Date.parse(d.finished_at)>=Date.parse(d.started_at),'Capture finished_at precedes started_at');

  object(d.receipt,
    ['authority','provider','provider_version','operation_id','profile','platform_job_id','native_receipt_sha256','build_observation','build_before','build_after','outcome'],
    ['authority','provider','provider_version','operation_id','profile','outcome']);
  choice(d.receipt.authority,['semwright-platform','semwright-native-driver','imported']);
  for(const k of ['provider','provider_version','operation_id','profile']) str(d.receipt[k],256);
  if(d.receipt.platform_job_id!==undefined) str(d.receipt.platform_job_id,256);
  if(d.receipt.native_receipt_sha256!==undefined) sha(d.receipt.native_receipt_sha256);
  choice(d.receipt.outcome,['SUCCEEDED','FAILED','UNKNOWN']);
  for(const k of ['build_observation','build_before','build_after']) if(d.receipt[k]!==undefined) str(d.receipt[k],256);

  object(d.readiness,['state','checks'],['state','checks']);
  choice(d.readiness.state,['READY','NOT_READY','UNKNOWN']);
  const readinessNames=new Set();
  array(d.readiness.checks,32).forEach(c=>{
    object(c,['name','state','detail'],['name','state']); str(c.name,96); choice(c.state,['PASS','FAIL','UNKNOWN']); if(c.detail!==undefined) str(c.detail,1000);
    ensure(!readinessNames.has(c.name),'Duplicate readiness check'); readinessNames.add(c.name);
  });

  const anchorNames=new Set();
  array(d.anchors,32).forEach(a=>{
    object(a,['name','observed_matches','source','detail'],['name','observed_matches','source']); str(a.name,128); integer(a.observed_matches,0,1000);
    choice(a.source,['native','accessible','visual','operator','imported']); if(a.detail!==undefined) str(a.detail,1000);
    ensure(!anchorNames.has(a.name),'Duplicate capture anchor observation'); anchorNames.add(a.name);
  });

  object(d.isolation,['context_id','auth_scope','mutable_state','tenant_scope'],['context_id','auth_scope','mutable_state']);
  str(d.isolation.context_id,256); choice(d.isolation.auth_scope,['run-scoped','fixture-scoped','operator-session','not-applicable']);
  ensure(typeof d.isolation.mutable_state==='boolean','Capture isolation mutable_state must be boolean');
  if(d.isolation.tenant_scope!==undefined) str(d.isolation.tenant_scope,256);

  object(d.cleanup,['policy','created_resource_ids','removed_resource_ids'],['policy','created_resource_ids','removed_resource_ids']);
  choice(d.cleanup.policy,['owned-resources-only','none','operator-managed']);
  array(d.cleanup.created_resource_ids,128).forEach(v=>str(v,256)); array(d.cleanup.removed_resource_ids,128).forEach(v=>str(v,256));
  ensure(new Set(d.cleanup.created_resource_ids).size===d.cleanup.created_resource_ids.length,'Duplicate created cleanup resource');
  ensure(new Set(d.cleanup.removed_resource_ids).size===d.cleanup.removed_resource_ids.length,'Duplicate removed cleanup resource');
  if(d.cleanup.policy==='owned-resources-only'){
    const owned=new Set(d.cleanup.created_resource_ids);
    ensure(d.cleanup.removed_resource_ids.every(id=>owned.has(id)),'Cleanup may only remove resources created by this run');
  }

  object(d.provenance,['capture_class','synthetic','parent_evidence_id','transformations'],['capture_class','synthetic','transformations']);
  choice(d.provenance.capture_class,['CAPTURED_ACTUAL','CAPTURED_DEMO_DATA','SANITIZED_DERIVATIVE','EDITORIAL_COMPOSITION','GENERATED_ILLUSTRATION','IMPORTED_UNVERIFIED']);
  ensure(typeof d.provenance.synthetic==='boolean','Capture provenance synthetic must be boolean');
  if(d.provenance.parent_evidence_id!==undefined) idText(d.provenance.parent_evidence_id);
  array(d.provenance.transformations,100).forEach(t=>{
    object(t,['kind','operation_ref','semantic_effect'],['kind','operation_ref','semantic_effect']);
    choice(t.kind,['CROP','REDACT','ANNOTATE','RESIZE','COMPOSE','TRANSLATE_OVERLAY']); str(t.operation_ref,256);
    choice(t.semantic_effect,['preserves-observed-state','changes-observed-state']);
  });

  array(d.observations,128).forEach(o=>{
    object(o,['kind','key','value','source'],['kind','key','value','source']);
    str(o.kind,96); str(o.key,160); str(o.value,4000); choice(o.source,['native','accessible','visual','operator','imported']);
  });
  if(d.segments!==undefined){
    let previousEnd=0;
    array(d.segments,256).forEach(s=>{
      object(s,['start_ms','end_ms','source_sha256','transform'],['start_ms','end_ms','source_sha256']);
      integer(s.start_ms,0,86400000); integer(s.end_ms,1,86400000); ensure(s.end_ms>s.start_ms,'Capture segment has invalid timing');
      ensure(s.start_ms>=previousEnd,'Capture segments overlap or are out of order'); previousEnd=s.end_ms; sha(s.source_sha256);
      if(s.transform!==undefined) str(s.transform,512);
    });
  }
  return d;
}

export function validateVerification(raw) {
  validateValue(raw); noSecrets(raw); const d=structuredClone(raw);
  object(d,
    ['candidate_id','candidate_sha256','dimension','state','verifier','verifier_profile_id','artifact_ids','target_id','coverage','omissions','findings','observed_at'],
    ['candidate_id','candidate_sha256','dimension','state','verifier','artifact_ids','coverage','omissions','findings','observed_at']);
  idText(d.candidate_id); sha(d.candidate_sha256); if(d.verifier_profile_id) idText(d.verifier_profile_id); if(d.target_id) idText(d.target_id);
  choice(d.dimension,['format','semantic','editorial','privacy','rights','accessibility','product-evidence','permissions']);
  choice(d.state,['PASS','FAIL','UNKNOWN','ERROR']);
  object(d.verifier,['id','version','digest','authority','model'],['id','version','digest','authority']);
  str(d.verifier.id,160); str(d.verifier.version,96); sha(d.verifier.digest);
  choice(d.verifier.authority,['canonical','independent','human','heuristic']);
  if(d.verifier.model!==undefined) str(d.verifier.model,160);
  array(d.artifact_ids,128).forEach(idText); ensure(d.artifact_ids.length>0,'Verification must bind at least one frozen candidate artifact'); ensure(new Set(d.artifact_ids).size===d.artifact_ids.length,'Duplicate verification artifact references');
  object(d.coverage,['checked','total','notes'],['checked','total']);
  integer(d.coverage.checked,0,1000000); integer(d.coverage.total,0,1000000);
  ensure(d.coverage.checked<=d.coverage.total,'Verification coverage checked exceeds total');
  if(d.coverage.notes!==undefined) lines(d.coverage.notes,4000);
  array(d.omissions,128).forEach(v=>str(v,512));
  array(d.findings,128).forEach(f=>{
    object(f,['code','severity','message','resource_id'],['code','severity','message']);
    str(f.code,96); choice(f.severity,['info','warning','error','blocker']); lines(f.message,4000); if(f.resource_id) idText(f.resource_id);
  });
  timestamp(d.observed_at,'Verification observed_at');
  return d;
}

export function validateWaiver(raw) {
  validateValue(raw); noSecrets(raw); const d=structuredClone(raw);
  object(d,['candidate_id','verification_id','reason','scope','expires_at'],['candidate_id','verification_id','reason','scope']);
  idText(d.candidate_id); idText(d.verification_id); lines(d.reason,4000); str(d.scope,512);
  if(d.expires_at!==undefined) timestamp(d.expires_at,'Waiver expires_at');
  return d;
}

export function validateChannelPackage(raw) {
  validateValue(raw); noSecrets(raw); const d=structuredClone(raw);
  object(d,['candidate_id','profile_id','participant','locale','allow_partial','omissions'],['candidate_id','profile_id','participant','locale','allow_partial','omissions']);
  idText(d.candidate_id); idText(d.profile_id); str(d.participant,160); str(d.locale,40);
  ensure(typeof d.allow_partial==='boolean','allow_partial must be boolean');
  array(d.omissions,128).forEach(v=>str(v,512));
  return d;
}

export function validateChannelOutcome(raw) {
  validateValue(raw); noSecrets(raw); const d=structuredClone(raw);
  object(d,['delivery_id','state','external_id','receipt_digest','observed_at','message'],['delivery_id','state','observed_at']);
  idText(d.delivery_id);
  choice(d.state,['UPLOADED','DRAFT_CREATED','ACTIVATED','PUBLISHED','FAILED','UNKNOWN','RETIRED']);
  if(d.external_id!==undefined) str(d.external_id,512);
  if(d.receipt_digest!==undefined) sha(d.receipt_digest);
  timestamp(d.observed_at,'Channel outcome observed_at');
  if(d.message!==undefined) lines(d.message,4000);
  return d;
}

export const now = iso;
