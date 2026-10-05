// SPDX-License-Identifier: AGPL-3.0-only
import { object, integer, validateValue, requireCondition as ensure } from '@semwright/native-sdk';
import { str, lines, array, choice, sha, noSecrets } from './contracts.mjs';

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
  str(d.name,160);choice(d.type,['source_adapter','deliverable_renderer','channel_adapter','verifier_profile']);str(d.package_version,96);integer(d.schema_major,1,32);sha(d.digest);str(d.license,128);str(d.source,2048);
  array(d.permissions,16).forEach(p=>choice(p,['read','edit','capture','review','publish']));ensure(new Set(d.permissions).size===d.permissions.length,'Duplicate extension permission');
  for(const key of ['inputs','outputs','preconditions','evidence'])array(d[key],32).forEach(v=>str(v,160));
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
