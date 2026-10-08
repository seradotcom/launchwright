// SPDX-License-Identifier: AGPL-3.0-only
import { requireCondition as ensure, integer, object } from '@semwright/native-sdk';
import { inputObject, idText, str, array, lines, noSecrets, digest, sha } from './contracts.mjs';

function isoTime(value,label){
  str(value,64);
  ensure(Number.isFinite(Date.parse(value)),label+' must be an ISO timestamp');
  return value;
}

export function validateCliObservation(raw){
  inputObject(raw,['source_id','target_id','extension_id','command','args','observed_build','started_at','finished_at','exit_code','stdout','stderr','runtime_receipt'],
    ['source_id','target_id','command','args','observed_build','started_at','finished_at','exit_code','stdout']);
  noSecrets(raw);
  const d=structuredClone(raw);
  idText(d.source_id);idText(d.target_id);if(d.extension_id)idText(d.extension_id);
  str(d.command,160);
  ensure(!/[<>\r\n]/.test(d.command),'CLI command label must be plain text');
  array(d.args,32).forEach(v=>{
    str(v,512);
    ensure(!/^(?:--?)?(?:token|password|secret|api[-_]?key|authorization)(?:=|$)/i.test(v),'Secret-bearing CLI flags are not admissible evidence');
  });
  str(d.observed_build,256);
  isoTime(d.started_at,'started_at');isoTime(d.finished_at,'finished_at');
  ensure(Date.parse(d.finished_at)>=Date.parse(d.started_at),'CLI receipt timestamps are reversed');
  integer(d.exit_code,0,65535);
  lines(d.stdout,32768);if(d.stderr!==undefined)lines(d.stderr,8192);
  if(d.runtime_receipt!==undefined){object(d.runtime_receipt,['file','sha256'],['file','sha256']);str(d.runtime_receipt.file,160);sha(d.runtime_receipt.sha256);}
  return d;
}

export function recordCliObservation(app,raw,runtimeAdmission=null){
  const d=validateCliObservation(raw);
  ensure(!d.runtime_receipt||runtimeAdmission,'Canonical runtime receipt requires the isolated Native extension runtime','PolicyDenied');
  const source=app.get(d.source_id,'source');
  ensure(source.data.type==='cli','CLI observation requires a cli source');
  ensure(source.data.approval==='approved'&&!!source.data.purpose,'CLI source must have an approved purpose','PermissionDenied');
  const target=app.get(d.target_id,'target');
  const release=app.get(target.data.release_id,'release');
  ensure(release.data.product_id===source.data.product_id,'CLI source and target belong to different products','PermissionDenied');
  ensure(source.data.build===release.data.build,'CLI source build differs from release','StaleReference');
  ensure(d.observed_build===source.data.build,'Observed CLI build differs from the approved source','StaleReference');
  let extension=null;
  if(d.extension_id){
    extension=app.get(d.extension_id,'extension_package');
    ensure(extension.data.type==='source_adapter','CLI adapter must be a source_adapter');
    ensure(extension.data.status==='active','CLI adapter has been retired','Conflict');
    ensure(extension.data.schema_major===1,'CLI adapter schema is unsupported','ProtocolMismatch');
    ensure(extension.data.outputs.includes('cli-observation/1'),'CLI adapter does not declare cli-observation/1 output','ProtocolMismatch');
  }
  const payload={
    schema_version:'launchwright-cli-observation/1',
    source_id:source.id,source_version:source.version,target_id:target.id,target_version:target.version,
    release_id:release.id,observed_build:d.observed_build,
    extension_id:extension?.id??null,extension_version:extension?.version??null,extension_digest:extension?.data.digest??null,
    command:d.command,args:d.args,started_at:d.started_at,finished_at:d.finished_at,exit_code:d.exit_code,
    stdout:d.stdout,stderr:d.stderr??'',
    stdout_sha256:digest('cli-stdout',d.stdout),stderr_sha256:digest('cli-stderr',d.stderr??''),
    process_outcome:d.exit_code===0?'SUCCESS':'FAILURE',
    technical_state:runtimeAdmission?'PASS':'UNKNOWN',host_isolation_verified:!!runtimeAdmission,
    ...(d.runtime_receipt?{runtime_receipt:d.runtime_receipt,runtime_admission:runtimeAdmission}:{}),
    authority:runtimeAdmission?'canonical-driver-host-admitted':'application-recorded-external-process-receipt'
  };
  payload.receipt_sha256=digest('cli-observation-v1',payload);
  return app.store.create('cli_observation',payload);
}

export function inspectCliObservation(app,id){
  const observation=app.get(id,'cli_observation'),d=observation.data,reasons=[];
  let source,target,extension=null;
  try{source=app.get(d.source_id,'source');}catch{reasons.push('source-missing');}
  try{target=app.get(d.target_id,'target');}catch{reasons.push('target-missing');}
  if(source&&JSON.stringify(source.version)!==JSON.stringify(d.source_version))reasons.push('source-revision-changed');
  if(target&&JSON.stringify(target.version)!==JSON.stringify(d.target_version))reasons.push('target-revision-changed');
  if(d.extension_id){
    try{extension=app.get(d.extension_id,'extension_package');}catch{reasons.push('extension-missing');}
    if(extension){
      if(extension.data.status!=='active')reasons.push('extension-retired');
      if(extension.data.digest!==d.extension_digest||JSON.stringify(extension.version)!==JSON.stringify(d.extension_version))reasons.push('extension-drift');
    }
  }
  let freshness='CURRENT';
  if(reasons.includes('extension-retired'))freshness='REVOKED_EXTENSION';
  else if(reasons.some(r=>r.includes('missing')))freshness='MISSING_REFERENCE';
  else if(reasons.length)freshness='STALE';
  const admitted=d.authority==='canonical-driver-host-admitted'&&d.host_isolation_verified===true;
  const technical_state=freshness==='CURRENT'&&admitted?d.technical_state:'UNKNOWN';
  return{observation,freshness,reasons,process_outcome:d.process_outcome,technical_state,host_isolation_verified:d.host_isolation_verified===true,verified_execution:admitted,
    note:admitted?'Exact Driver Host execution receipt is preserved; drift can invalidate current technical PASS without rewriting history.':'The process receipt is real application evidence, but canonical Driver Host isolation/admission has not been established.'};
}
