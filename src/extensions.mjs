// SPDX-License-Identifier: AGPL-3.0-only
import { object, integer, validateValue, requireCondition as ensure } from '@semwright/native-sdk';
import { str, lines, array, choice, sha, noSecrets, inputObject, idText } from './contracts.mjs';

export const PROFILE_MATRIX=Object.freeze({
  browser:{source_types:['web'],execution:'canonical-driver-required',capture:'requires-authorized-driver',readback:'provider-dependent'},
  cli:{source_types:['cli'],execution:'sandboxed-real-tool-required',capture:'stdout-stderr-receipt-required',readback:'process-output'},
  'mobile-import':{source_types:['mobile-import'],execution:'import-only',capture:'external-origin-required',readback:'bundle-provenance-only'},
  godot:{source_types:['godot'],execution:'canonical-driver-required',capture:'scene-camera-behavior-contract-required',readback:'driver-supported-only'},
  document:{source_types:['document'],execution:'parse-only',capture:'not-applicable',readback:'bounded-structured-import'}
});

export function validateExtensionManifest(raw){
  validateValue(raw);noSecrets(raw);const d=structuredClone(raw);
  object(d,['name','type','package_version','schema_major','digest','license','source','permissions','inputs','outputs','preconditions','evidence','limits'],['name','type','package_version','schema_major','digest','license','source','permissions','inputs','outputs','preconditions','evidence','limits']);
  str(d.name,160);ensure(!/[<>]/.test(d.name),'Extension name must be plain text');choice(d.type,['source_adapter','deliverable_renderer','channel_adapter','verifier_profile']);str(d.package_version,96);integer(d.schema_major,1,32);sha(d.digest);str(d.license,128);str(d.source,2048);
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
  ensure(ext.data.schema_major===d.client_schema_major,'Extension schema major is incompatible','ProtocolMismatch');
  ensure(ext.data.inputs.includes(d.input_type),'Requested input type is not declared by the extension','ProtocolMismatch');
  ensure(ext.data.outputs.includes(d.output_type),'Requested output type is not declared by the extension','ProtocolMismatch');
  return app.store.create('extension_preparation',{...d,extension_version:ext.version,package_version:ext.data.package_version,digest:ext.data.digest,
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
    package_version:d.package_version,schema_major:d.schema_major,license:d.license,source:d.source,
    properties:[
      {name:'inputs',type:'string-list',value:d.inputs},{name:'outputs',type:'string-list',value:d.outputs},
      {name:'preconditions',type:'string-list',value:d.preconditions},{name:'evidence',type:'string-list',value:d.evidence},
      {name:'limits',type:'bounded-object',value:d.limits}
    ],
    requested_permissions:d.permissions,allowed_actions:[],trusted_markup:false,remote_code_execution:false,
    authority:'descriptor-metadata-does-not-grant-capability'
  };
}
