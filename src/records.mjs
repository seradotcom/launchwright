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
    ['release_id','target_id','source_id','scenario_id','name','build','classification','rights','started_at','finished_at','receipt','observations','segments'],
    ['release_id','target_id','source_id','scenario_id','name','build','classification','rights','started_at','finished_at','receipt','observations']);
  for(const k of ['release_id','target_id','source_id','scenario_id']) idText(d[k]);
  str(d.name,160); str(d.build,256);
  choice(d.classification,['actual','demo','sanitized','imported']);
  choice(d.rights,['owned','licensed','unknown','restricted']);
  timestamp(d.started_at,'Capture started_at'); timestamp(d.finished_at,'Capture finished_at');
  ensure(Date.parse(d.finished_at)>=Date.parse(d.started_at),'Capture finished_at precedes started_at');
  object(d.receipt,
    ['authority','provider','provider_version','operation_id','profile','build_observation','outcome'],
    ['authority','provider','provider_version','operation_id','profile','outcome']);
  choice(d.receipt.authority,['semwright-platform','semwright-native-driver','imported']);
  for(const k of ['provider','provider_version','operation_id','profile']) str(d.receipt[k],256);
  choice(d.receipt.outcome,['SUCCEEDED','FAILED','UNKNOWN']);
  if(d.receipt.build_observation!==undefined) str(d.receipt.build_observation,256);
  array(d.observations,128).forEach(o=>{
    object(o,['kind','key','value','source'],['kind','key','value','source']);
    str(o.kind,96); str(o.key,160); str(o.value,4000); choice(o.source,['native','accessible','visual','operator','imported']);
  });
  if(d.segments!==undefined) array(d.segments,256).forEach(s=>{
    object(s,['start_ms','end_ms','source_sha256','transform'],['start_ms','end_ms','source_sha256']);
    integer(s.start_ms,0,86400000); integer(s.end_ms,1,86400000); ensure(s.end_ms>s.start_ms,'Capture segment has invalid timing'); sha(s.source_sha256);
    if(s.transform!==undefined) str(s.transform,512);
  });
  return d;
}

export function validateVerification(raw) {
  validateValue(raw); noSecrets(raw); const d=structuredClone(raw);
  object(d,
    ['candidate_id','dimension','state','verifier','artifact_ids','target_id','coverage','omissions','findings','observed_at'],
    ['candidate_id','dimension','state','verifier','artifact_ids','coverage','omissions','findings','observed_at']);
  idText(d.candidate_id); if(d.target_id) idText(d.target_id);
  choice(d.dimension,['format','semantic','editorial','privacy','rights','accessibility','product-evidence','permissions']);
  choice(d.state,['PASS','FAIL','UNKNOWN','ERROR']);
  object(d.verifier,['id','version','digest','authority','model'],['id','version','digest','authority']);
  str(d.verifier.id,160); str(d.verifier.version,96); sha(d.verifier.digest);
  choice(d.verifier.authority,['canonical','independent','human','heuristic']);
  if(d.verifier.model!==undefined) str(d.verifier.model,160);
  array(d.artifact_ids,128).forEach(idText);
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
