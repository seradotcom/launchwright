// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from 'node:crypto';
import { requireCondition as ensure, object, validateValue } from '@semwright/native-sdk';
import { inputObject, array, str, sha, noSecrets, iso } from './contracts.mjs';

export const EFFECT_RESULT_SCHEMA='semwright-native-effects-result/1';
export const EFFECT_SCOPE='immutable_native_sdk_artifact_properties_only';

const textBytes=value=>Buffer.from(value,'utf8');
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');

function parseResult(text){
  ensure(typeof text==='string'&&Buffer.byteLength(text)>0&&Buffer.byteLength(text)<=192000,'Canonical Effects result exceeds bounded storage contract','ResourceExhausted');
  let result;try{result=JSON.parse(text);}catch{ensure(false,'Canonical Effects result is not valid JSON','InvalidArgument');}
  validateValue(result);
  object(result,[
    'schema_version','spec_sha256','source_digest','runtime_digest',
    'declared_producer_execution_status','context_attestation','inspection_state',
    'scope','execution_authority','evaluation','verdict','private_measurements'
  ],[
    'schema_version','spec_sha256','source_digest','runtime_digest',
    'declared_producer_execution_status','context_attestation','inspection_state',
    'scope','execution_authority','evaluation','verdict','private_measurements'
  ]);
  noSecrets(result);
  ensure(result.schema_version===EFFECT_RESULT_SCHEMA,'Unsupported canonical Effects result schema','ProtocolMismatch');
  sha(result.spec_sha256);sha(result.source_digest);sha(result.runtime_digest);
  str(result.context_attestation,4096);
  ensure(['prepared','applying','completed','partial','denied','cancelled','failed','unknown'].includes(result.declared_producer_execution_status),'Unsupported producer execution status');
  ensure(['EVALUATED','INCOMPLETE','ERROR'].includes(result.inspection_state),'Unsupported Effects inspection state');
  ensure(result.scope===EFFECT_SCOPE,'Effects result scope differs from the Native SDK readback scope','ProtocolMismatch');
  ensure(result.execution_authority===false,'Effects readback must never carry execution authority','ProtocolMismatch');
  ensure(['PASS','FAIL','UNKNOWN'].includes(result.verdict),'Unsupported canonical Effects verdict');
  object(result.evaluation);
  array(result.private_measurements,64);
  for(const measurement of result.private_measurements){
    object(measurement);
    if(measurement.observation!==null&&measurement.observation!==undefined){
      object(measurement.observation);
      if(measurement.observation.artifact!==null&&measurement.observation.artifact!==undefined)sha(measurement.observation.artifact);
    }
  }
  return result;
}
function receiptCurrent(app,receipt){
  const drift=[];
  try{app.store.readBlob(receipt.data.result_blob_sha256);}catch{drift.push({id:receipt.id,reason:'effect-result-bytes-unavailable'});}
  try{app.store.readBlob(receipt.data.spec_blob_sha256);}catch{drift.push({id:receipt.id,reason:'effect-spec-bytes-unavailable'});}
  for(const pin of receipt.data.artifact_pins){
    let artifact;
    try{artifact=app.get(pin.id,'artifact');}catch{drift.push({id:pin.id,reason:'artifact-missing'});continue;}
    if(artifact.version.generation!==pin.version.generation||artifact.version.revision!==pin.version.revision)drift.push({id:pin.id,reason:'artifact-revision-changed',expected:pin.version,observed:artifact.version});
    for(const changed of app.freshness(artifact.data.inputs??[]))drift.push({id:pin.id,reason:'artifact-input-changed',changed});
    try{app.store.readBlob(artifact.data.sha256);}catch{drift.push({id:pin.id,reason:'artifact-bytes-unavailable'});}
  }
  if(receipt.data.scenario_pin){
    try{
      const scenario=app.get(receipt.data.scenario_pin.id,'scenario');
      if(scenario.version.generation!==receipt.data.scenario_pin.version.generation||scenario.version.revision!==receipt.data.scenario_pin.version.revision)drift.push({id:scenario.id,reason:'scenario-revision-changed',expected:receipt.data.scenario_pin.version,observed:scenario.version});
    }catch{drift.push({id:receipt.data.scenario_pin.id,reason:'scenario-missing'});}
  }
  return drift;
}

export function recordEffectResult(app,input){
  inputObject(input,['release_id','scenario_id','artifact_ids','spec_text','result_text','admit'],['release_id','artifact_ids','spec_text','result_text']);
  const release=app.get(input.release_id,'release');
  const artifactIds=array(input.artifact_ids,16);
  ensure(artifactIds.length>0&&new Set(artifactIds).size===artifactIds.length,'Effects receipt requires unique bound artifacts');
  const artifacts=artifactIds.map(id=>{
    const artifact=app.get(id,'artifact');
    ensure(artifact.data.release_id===release.id,'Effects artifact belongs to another release','PermissionDenied');
    ensure(['application/json','text/csv'].includes(String(artifact.data.mime).split(';')[0]),'Native SDK Effects readback supports only JSON or CSV artifacts','InvalidArgument');
    app.store.readBlob(artifact.data.sha256);
    return artifact;
  });
  let scenario=null;
  if(input.scenario_id!==undefined){
    scenario=app.get(input.scenario_id,'scenario');
    ensure(scenario.data.release_id===release.id,'Effects scenario belongs to another release','PermissionDenied');
  }
  ensure(typeof input.spec_text==='string'&&Buffer.byteLength(input.spec_text)>0&&Buffer.byteLength(input.spec_text)<=512*1024,'Canonical Effects spec exceeds bounded storage contract','ResourceExhausted');
  let spec;try{spec=JSON.parse(input.spec_text);}catch{ensure(false,'Canonical Effects spec is not valid JSON','InvalidArgument');}
  validateValue(spec);object(spec);noSecrets(spec);ensure(spec.schema_version==='semwright-native-effects-spec/1','Unsupported canonical Effects spec schema','ProtocolMismatch');
  const specBytes=textBytes(input.spec_text),specSha=sha256(specBytes),result=parseResult(input.result_text);
  ensure(result.spec_sha256===specSha,'Canonical Effects result is bound to a different protected spec','Conflict');
  const localDigests=new Set(artifacts.map(a=>a.data.sha256));
  const observedDigests=new Set();
  for(const measurement of result.private_measurements){
    const observed=measurement?.observation?.artifact;
    if(observed){
      ensure(localDigests.has(observed),'Effects result contains an artifact outside the bound Launchwright set','PermissionDenied');
      observedDigests.add(observed);
    }
  }
  if(['PASS','FAIL'].includes(result.verdict)){ensure(result.inspection_state==='EVALUATED','Decisive Effects verdict requires an evaluated canonical inspection','Conflict');ensure([...localDigests].every(hash=>observedDigests.has(hash)),'Decisive Effects verdict does not cover every bound artifact','Conflict');}
  if(input.admit===true)ensure(app.capabilities.canonical_effect_admission===true,'Canonical Effects admission is unavailable in this session','PolicyDenied');
  const specBlob=app.store.blob(specBytes,'application/json',{maxBytes:512*1024,label:'Effects spec'});
  ensure(specBlob===specSha,'Effects spec blob digest mismatch','Conflict');
  const bytes=textBytes(input.result_text),resultBlob=app.store.blob(bytes,'application/json',{maxBytes:192000,label:'Effects result'});
  const resultSha=sha256(bytes);ensure(resultBlob===resultSha,'Effects result blob digest mismatch','Conflict');
  const bindingIds=artifacts.map(a=>a.id).sort(),scenarioId=scenario?.id??null;
  const duplicate=app.list('effect_result',release.id).find(row=>row.data.result_sha256===resultSha&&row.data.scenario_id===scenarioId&&JSON.stringify(row.data.artifact_pins.map(p=>p.id).sort())===JSON.stringify(bindingIds));
  if(duplicate)return{entity:duplicate,reused:true};
  const admitted=input.admit===true&&app.capabilities.canonical_effect_admission===true;
  return{entity:app.store.create('effect_result',{
    release_id:release.id,name:'Effects readback · '+result.verdict,
    scenario_id:scenario?.id??null,scenario_pin:scenario?{id:scenario.id,version:scenario.version}:null,
    artifact_pins:artifacts.map(a=>({id:a.id,version:a.version,sha256:a.data.sha256,mime:a.data.mime})).sort((a,b)=>a.id.localeCompare(b.id)),
    result_sha256:resultSha,result_blob_sha256:resultBlob,spec_sha256:specSha,spec_blob_sha256:specBlob,
    source_digest:result.source_digest,runtime_digest:result.runtime_digest,
    reported_verdict:result.verdict,inspection_state:result.inspection_state,
    scope:result.scope,admission:admitted?'canonical-owner-admitted':'canonical-result-not-admitted',
    execution_authority:false,scenario_effects_covered:false,
    recorded_by:app.principal,recorded_at:iso()
  }),reused:false};
}

export function inspectEffects(app,input){
  inputObject(input,['release_id','scenario_id'],['release_id']);const release=app.get(input.release_id,'release');
  if(input.scenario_id!==undefined){const scenario=app.get(input.scenario_id,'scenario');ensure(scenario.data.release_id===release.id,'Scenario belongs to another release','PermissionDenied');}
  const receipts=app.list('effect_result',release.id)
    .filter(row=>input.scenario_id===undefined||row.data.scenario_id===input.scenario_id)
    .map(row=>{
      const drift=receiptCurrent(app,row),current=drift.length===0,admitted=row.data.admission==='canonical-owner-admitted';
      const effective=!current?'UNKNOWN':row.data.reported_verdict==='FAIL'?'FAIL':admitted&&row.data.reported_verdict==='PASS'?'PASS':'UNKNOWN';
      return{id:row.id,version:row.version,result_sha256:row.data.result_sha256,spec_sha256:row.data.spec_sha256,
        reported_verdict:row.data.reported_verdict,effective_verdict:effective,inspection_state:row.data.inspection_state,
        admission:row.data.admission,current,drift,artifact_pins:row.data.artifact_pins,scenario_id:row.data.scenario_id,
        scope:row.data.scope,execution_authority:false,scenario_effects_covered:false};
    });
  const state=receipts.some(r=>r.effective_verdict==='FAIL')?'FAIL':receipts.length&&receipts.every(r=>r.effective_verdict==='PASS')?'PASS':'UNKNOWN';
  return{schema_version:'launchwright-effects-status/1',release_id:release.id,scenario_id:input.scenario_id??null,state,receipts,
    canonical_passes:receipts.filter(r=>r.effective_verdict==='PASS').length,
    failures:receipts.filter(r=>r.effective_verdict==='FAIL').length,
    unknown:receipts.filter(r=>r.effective_verdict==='UNKNOWN').length,
    scope:EFFECT_SCOPE,scenario_effects_authority:false,
    note:'Canonical Native SDK immutable-artifact readback is narrower than native application effect/noninterference verification.'};
}
