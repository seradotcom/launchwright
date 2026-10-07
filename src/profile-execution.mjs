// SPDX-License-Identifier: AGPL-3.0-only
import { object, integer, requireCondition as ensure } from '@semwright/native-sdk';
import { inputObject, idText, str, array, sha, noSecrets, digest, iso } from './contracts.mjs';
import { PROFILE_MATRIX } from './extensions.mjs';

export const PROFILE_RUNTIME_SEMWRIGHT_SHA='8fa191250ae68274182570c65f067f7a60f85625';
export const GODOT_PROFILE_REQUIREMENT='RS-PRO-02';
export const GODOT_REQUIRED_OPERATIONS=Object.freeze([
  'driver.godot.scene.create',
  'driver.godot.scene.inspect',
  'driver.godot.scene.save',
  'driver.godot.scene.reload',
  'driver.godot.camera.configure',
  'driver.godot.camera.inspect',
  'driver.godot.node.inspect',
  'driver.godot.script.write',
  'driver.godot.script.attach',
  'driver.godot.project.validate',
  'driver.godot.project.run_test',
  'driver.godot.export.pack'
]);

function commit(value,label){
  str(value,40);
  ensure(/^[0-9a-f]{40}$/.test(value),label+' must be a full lowercase commit SHA');
  return value;
}
function timestamp(value,label){
  str(value,64);
  ensure(Number.isFinite(Date.parse(value)),label+' must be an ISO timestamp');
  return value;
}
function bool(value,label){
  ensure(typeof value==='boolean',label+' must be boolean');
  return value;
}

export function validateProfileExecution(raw){
  inputObject(raw,[
    'profile','source_id','target_id','name','semwright_sha','engine','driver','trace_sha256',
    'observed_operations','semantics','runtime_marker','redacted_artifact_refs',
    'driver_host_conformance_observed','started_at','finished_at'
  ]);
  noSecrets(raw);
  const d=structuredClone(raw);
  str(d.profile,64);ensure(PROFILE_MATRIX[d.profile],'Unknown profile','NotFound');
  idText(d.source_id);idText(d.target_id);str(d.name,160);
  commit(d.semwright_sha,'Semwright source lock');
  object(d.engine,['family','version','binary_sha256','real'],['family','version','binary_sha256','real']);
  str(d.engine.family,64);str(d.engine.version,128);sha(d.engine.binary_sha256);bool(d.engine.real,'engine.real');
  object(d.driver,['namespace','protocol','capability_count','binary_sha256'],['namespace','protocol','capability_count','binary_sha256']);
  str(d.driver.namespace,128);integer(d.driver.protocol,1,64);integer(d.driver.capability_count,1,10000);sha(d.driver.binary_sha256);
  sha(d.trace_sha256);
  array(d.observed_operations,512).forEach(op=>{str(op,160);ensure(/^driver\.[a-z0-9_.-]+$/.test(op),'Invalid observed driver operation');});
  ensure(new Set(d.observed_operations).size===d.observed_operations.length,'Duplicate observed driver operations');
  object(d.semantics,['scene','camera','behavior','readback','persistence','runtime'],['scene','camera','behavior','readback','persistence','runtime']);
  for(const key of ['scene','camera','behavior','readback','persistence','runtime'])bool(d.semantics[key],'semantics.'+key);
  str(d.runtime_marker,160);
  array(d.redacted_artifact_refs,32).forEach(ref=>{
    str(ref,256);
    ensure(/^(?:artifact|receipt|sha256):[A-Za-z0-9_.:-]+$/.test(ref),'Artifact references must be redacted logical references');
  });
  bool(d.driver_host_conformance_observed,'driver_host_conformance_observed');
  timestamp(d.started_at,'started_at');timestamp(d.finished_at,'finished_at');
  ensure(Date.parse(d.finished_at)>=Date.parse(d.started_at),'Profile execution timestamps are reversed');

  if(d.profile==='godot'){
    ensure(d.semwright_sha===PROFILE_RUNTIME_SEMWRIGHT_SHA,'Godot receipt targets another reviewed Semwright source','StaleReference');
    ensure(d.engine.family==='Godot'&&d.engine.version.startsWith('4.7.2'),'Godot profile requires the reviewed Godot 4.7.2 engine','ProtocolMismatch');
    ensure(d.engine.real===true,'Godot native acceptance requires a real engine execution','InvalidArgument');
    ensure(d.driver.namespace==='driver.godot.','Godot profile requires the canonical driver namespace','ProtocolMismatch');
    ensure(d.driver.protocol===3,'Godot profile requires the reviewed Driver Protocol version','ProtocolMismatch');
    ensure(d.driver.capability_count===188,'Godot capability catalog differs from the reviewed source lock','ProtocolMismatch');
    ensure(Object.values(d.semantics).every(Boolean),'Godot receipt must cover scene, camera, behavior, readback, persistence and runtime semantics','InvalidArgument');
    for(const operation of GODOT_REQUIRED_OPERATIONS)ensure(d.observed_operations.includes(operation),'Godot receipt is missing required operation '+operation,'InvalidArgument');
    ensure(d.runtime_marker==='SEMWRIGHT_LAB_READY','Godot runtime behavior marker was not observed','InvalidArgument');
  }
  return d;
}

export function recordProfileExecution(app,raw){
  const d=validateProfileExecution(raw);
  const profile=PROFILE_MATRIX[d.profile],source=app.get(d.source_id,'source'),target=app.get(d.target_id,'target'),release=app.get(target.data.release_id,'release');
  ensure(profile.source_types.includes(source.data.type),'Source type is incompatible with profile','ProtocolMismatch');
  ensure(source.data.product_id===release.data.product_id,'Profile source and target belong to different products','PermissionDenied');
  ensure(source.data.approval==='approved'&&!!source.data.purpose,'Profile execution requires an approved source purpose','PermissionDenied');
  ensure(source.data.build===release.data.build,'Profile source build differs from release','StaleReference');

  const payload={
    schema_version:'launchwright-profile-execution/1',
    requirement_id:d.profile==='godot'?GODOT_PROFILE_REQUIREMENT:null,
    profile:d.profile,source_id:source.id,source_version:source.version,target_id:target.id,target_version:target.version,
    release_id:release.id,release_build:release.data.build,name:d.name,semwright_sha:d.semwright_sha,
    engine:d.engine,driver:d.driver,trace_sha256:d.trace_sha256,observed_operations:d.observed_operations,
    semantics:d.semantics,runtime_marker:d.runtime_marker,redacted_artifact_refs:d.redacted_artifact_refs,
    driver_host_conformance_observed:d.driver_host_conformance_observed,
    engine_execution_observed:d.engine.real===true,video_import_substitute:false,
    native_acceptance:'EVIDENCE_RECORDED',technical_state:'UNKNOWN',
    authority:'application-custody-only',recorded_by:app.principal,recorded_at:iso(),
    started_at:d.started_at,finished_at:d.finished_at
  };
  payload.receipt_sha256=digest('profile-execution-v1',payload);
  return app.store.create('profile_execution',payload);
}

export function inspectProfileExecution(app,id){
  const execution=app.get(id,'profile_execution'),d=execution.data,reasons=[];
  let source=null,target=null;
  try{source=app.get(d.source_id,'source');}catch{reasons.push('source-missing');}
  try{target=app.get(d.target_id,'target');}catch{reasons.push('target-missing');}
  if(source&&JSON.stringify(source.version)!==JSON.stringify(d.source_version))reasons.push('source-revision-changed');
  if(target&&JSON.stringify(target.version)!==JSON.stringify(d.target_version))reasons.push('target-revision-changed');
  if(d.profile==='godot'&&d.semwright_sha!==PROFILE_RUNTIME_SEMWRIGHT_SHA)reasons.push('semwright-source-lock-changed');
  const freshness=reasons.some(r=>r.endsWith('-missing'))?'MISSING_REFERENCE':reasons.length?'STALE':'CURRENT';
  return{
    execution,freshness,reasons,
    profile_contract:PROFILE_MATRIX[d.profile],
    engine_execution_observed:d.engine_execution_observed===true,
    video_import_substitute:false,
    native_acceptance:'EVIDENCE_RECORDED',
    technical_state:'UNKNOWN',
    exact_sha_ci_acceptance:false,
    note:'This durable Native SDK receipt preserves profile evidence. Exact-SHA CI acceptance is separate and cannot be manufactured by application input.'
  };
}
