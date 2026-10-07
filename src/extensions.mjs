// SPDX-License-Identifier: AGPL-3.0-only
import { object, integer, validateValue, requireCondition as ensure } from '@semwright/native-sdk';
import { str, lines, array, choice, sha, noSecrets, inputObject, idText, digest } from './contracts.mjs';

export const PROFILE_MATRIX=Object.freeze({
  browser:{source_types:['web'],execution:'canonical-driver-required',capture:'requires-authorized-driver',readback:'provider-dependent'},
  cli:{source_types:['cli'],execution:'sandboxed-real-tool-required',capture:'stdout-stderr-receipt-required',readback:'process-output'},
  'mobile-import':{source_types:['mobile-import'],execution:'import-only',capture:'external-origin-required',readback:'bundle-provenance-only'},
  godot:{source_types:['godot'],execution:'canonical-driver-required',capture:'scene-camera-behavior-contract-required',readback:'driver-supported-only',semantics:['scene','camera','behavior','readback'],native_acceptance:{engine_real_required:true,video_import_substitute:false,engine_family:'Godot',reviewed_engine:'4.7.2',driver_namespace:'driver.godot.'}},
  document:{source_types:['document'],execution:'parse-only',capture:'not-applicable',readback:'bounded-structured-import'}
});

export function validateExtensionManifest(raw){
  validateValue(raw);noSecrets(raw);const d=structuredClone(raw);
  object(d,['name','type','package_version','schema_major','digest','license','rights','source','permissions','inputs','outputs','preconditions','evidence','limits'],['name','type','package_version','schema_major','digest','license','source','permissions','inputs','outputs','preconditions','evidence','limits']);
  str(d.name,160);ensure(!/[<>]/.test(d.name),'Extension name must be plain text');choice(d.type,['source_adapter','deliverable_renderer','channel_adapter','verifier_profile']);str(d.package_version,96);integer(d.schema_major,1,32);sha(d.digest);str(d.license,128);d.rights=d.rights??'unresolved';choice(d.rights,['owned','licensed','open-source','unresolved']);str(d.source,2048);
  ensure(!/^\s*(?:javascript|data):/i.test(d.source)&&!/[<>]/.test(d.source),'Extension source must be a non-executable locator');
  array(d.permissions,16).forEach(p=>choice(p,['read','edit','capture','review','publish']));ensure(new Set(d.permissions).size===d.permissions.length,'Duplicate extension permission');
  for(const key of ['inputs','outputs','preconditions','evidence'])array(d[key],32).forEach(v=>{str(v,160);ensure(!/[<>]/.test(v),'Extension descriptors must be plain text');});
  object(d.limits,['max_input_bytes','max_output_bytes','timeout_seconds'],['max_input_bytes','max_output_bytes','timeout_seconds']);
  integer(d.limits.max_input_bytes,1,67108864);integer(d.limits.max_output_bytes,1,67108864);integer(d.limits.timeout_seconds,1,3600);
  return d;
}

export function validateCompatibilityLock(raw){
  validateValue(raw);noSecrets(raw);const d=structuredClone(raw);
  object(d,['product_id','name','components','notes'],['product_id','name','components']);str(d.product_id,128);str(d.name,160);
  array(d.components,64).forEach(c=>{object(c,['kind','name','version','digest','resource_id'],['kind','name','version']);choice(c.kind,['native-sdk','platform-client','source-adapter','renderer','channel-adapter','channel-profile','verifier','template']);str(c.name,160);str(c.version,128);if(c.digest)sha(c.digest);if(c.resource_id)str(c.resource_id,128);});
  ensure(new Set(d.components.map(c=>c.kind+'|'+c.name)).size===d.components.length,'Duplicate compatibility component');
  if(d.notes!==undefined)lines(d.notes,8000);
  return d;
}


export function validateExtensionPreparation(raw){
  inputObject(raw,['extension_id','name','purpose','input_type','output_type','client_schema_major'],
    ['extension_id','name','purpose','input_type','output_type','client_schema_major']);
  const d=structuredClone(raw);noSecrets(d);idText(d.extension_id);str(d.name,160);lines(d.purpose,2000);
  str(d.input_type,160);str(d.output_type,160);integer(d.client_schema_major,1,32);
  for(const value of [d.name,d.input_type,d.output_type])ensure(!/[<>]/.test(value),'Extension preparation metadata must be plain text');
  return d;
}

export function prepareExtensionUse(app,raw){
  const d=validateExtensionPreparation(raw),ext=app.get(d.extension_id,'extension_package');
  ensure(ext.data.status==='active','Extension is retired; new use is blocked','Conflict');
  ensure(ext.data.rights!=='unresolved','Extension rights must be resolved before use','PolicyDenied');
  ensure(ext.data.schema_major===d.client_schema_major,'Extension schema major is incompatible','ProtocolMismatch');
  ensure(ext.data.inputs.includes(d.input_type),'Requested input type is not declared by the extension','ProtocolMismatch');
  ensure(ext.data.outputs.includes(d.output_type),'Requested output type is not declared by the extension','ProtocolMismatch');
  return app.store.create('extension_preparation',{...d,extension_version:ext.version,package_version:ext.data.package_version,digest:ext.data.digest,license:ext.data.license,rights:ext.data.rights,
    state:'PREPARED',prepared_by:app.principal,prepared_at:new Date().toISOString(),authority:'application-preparation-only'});
}

export function inspectExtensionPreparation(app,id){
  const prep=app.get(id,'extension_preparation'),d=prep.data;let ext=null,state='CURRENT',reasons=[];
  try{ext=app.get(d.extension_id,'extension_package');}catch{state='MISSING_EXTENSION';reasons.push('extension-missing');}
  if(ext){
    if(ext.data.status!=='active'){state='REVOKED_FOR_NEW_START';reasons.push('extension-retired');}
    else if(ext.data.digest!==d.digest||ext.data.package_version!==d.package_version||JSON.stringify(ext.version)!==JSON.stringify(d.extension_version)){
      state='DRIFT';reasons.push('extension-version-or-digest-changed');
    }
  }
  return{preparation:prep,state,reasons,start_allowed:state==='CURRENT',historical_record_preserved:true,
    note:'Retirement blocks new starts but never deletes the preparation or prior execution evidence.'};
}

export function genericExtensionView(ext){
  ensure(ext&&ext.kind==='extension_package','Generic extension view requires an extension package');
  const d=ext.data;
  return{
    schema_version:'launchwright-extension-generic-view/1',id:ext.id,version:ext.version,name:d.name,type:d.type,status:d.status,
    package_version:d.package_version,schema_major:d.schema_major,license:d.license,rights:d.rights,source:d.source,
    properties:[
      {name:'inputs',type:'string-list',value:d.inputs},{name:'outputs',type:'string-list',value:d.outputs},
      {name:'preconditions',type:'string-list',value:d.preconditions},{name:'evidence',type:'string-list',value:d.evidence},
      {name:'limits',type:'bounded-object',value:d.limits}
    ],
    requested_permissions:d.permissions,allowed_actions:[],trusted_markup:false,remote_code_execution:false,
    authority:'descriptor-metadata-does-not-grant-capability'
  };
}


export function validateExtensionResult(raw){
  inputObject(raw,['preparation_id','input_sha256','output_type','outcome','started_at','finished_at','output'],
    ['preparation_id','input_sha256','output_type','outcome','started_at','finished_at','output']);
  const d=structuredClone(raw);noSecrets(d);idText(d.preparation_id);sha(d.input_sha256);str(d.output_type,160);
  choice(d.outcome,['SUCCESS','FAILURE']);str(d.started_at,64);str(d.finished_at,64);
  ensure(Number.isFinite(Date.parse(d.started_at))&&Number.isFinite(Date.parse(d.finished_at)),'Extension receipt timestamps must be ISO dates');
  ensure(Date.parse(d.finished_at)>=Date.parse(d.started_at),'Extension receipt timestamps are reversed');
  validateValue(d.output);const bytes=Buffer.byteLength(JSON.stringify(d.output));
  ensure(bytes<=65536,'Extension result exceeds application receipt budget','ResourceExhausted');
  return{...d,output_bytes:bytes};
}

export function recordExtensionResult(app,raw){
  const d=validateExtensionResult(raw),prep=app.get(d.preparation_id,'extension_preparation');
  const status=inspectExtensionPreparation(app,prep.id);ensure(status.start_allowed,'Extension preparation is no longer valid','Conflict');
  const ext=app.get(prep.data.extension_id,'extension_package');
  ensure(d.output_type===prep.data.output_type,'Extension result output type differs from preparation','ProtocolMismatch');
  ensure(d.output_bytes<=ext.data.limits.max_output_bytes,'Extension output exceeds package budget','ResourceExhausted');
  const payload={
    schema_version:'launchwright-extension-result/1',preparation_id:prep.id,preparation_version:prep.version,
    extension_id:ext.id,extension_version:prep.data.extension_version,extension_digest:prep.data.digest,
    package_version:prep.data.package_version,license:prep.data.license,rights:prep.data.rights,
    input_sha256:d.input_sha256,output_type:d.output_type,output:d.output,output_bytes:d.output_bytes,
    output_sha256:digest('extension-output-v1',d.output),started_at:d.started_at,finished_at:d.finished_at,
    process_outcome:d.outcome,technical_state:'UNKNOWN',host_isolation_verified:false,
    recorded_by:app.principal,recorded_at:new Date().toISOString(),authority:'application-recorded-extension-receipt'
  };
  return app.store.create('extension_result',payload);
}

export function inspectExtensionResult(app,id){
  const result=app.get(id,'extension_result'),d=result.data,reasons=[];
  let prep=null,ext=null;
  try{prep=app.get(d.preparation_id,'extension_preparation');}catch{reasons.push('preparation-missing');}
  try{ext=app.get(d.extension_id,'extension_package');}catch{reasons.push('extension-missing');}
  if(prep&&JSON.stringify(prep.version)!==JSON.stringify(d.preparation_version))reasons.push('preparation-drift');
  if(ext){
    if(ext.data.status!=='active')reasons.push('extension-retired');
    if(ext.data.digest!==d.extension_digest||ext.data.package_version!==d.package_version||JSON.stringify(ext.version)!==JSON.stringify(d.extension_version))reasons.push('extension-drift');
  }
  let freshness='CURRENT';
  if(reasons.includes('extension-retired'))freshness='REVOKED_EXTENSION';
  else if(reasons.some(x=>x.endsWith('-missing')))freshness='MISSING_REFERENCE';
  else if(reasons.length)freshness='STALE';
  return{result,freshness,reasons,process_outcome:d.process_outcome,technical_state:'UNKNOWN',verified_execution:false,host_isolation_verified:false,
    note:'A process receipt is preserved evidence, not canonical Host admission or verifier PASS.'};
}
