// SPDX-License-Identifier: AGPL-3.0-only
import { object, integer, validateValue, requireCondition as ensure } from '@semwright/native-sdk';
import { str, lines, array, choice, sha, noSecrets } from './contracts.mjs';
export { PROFILE_MATRIX } from './source-profiles.mjs';

export function validateExtensionManifest(raw){
  validateValue(raw);noSecrets(raw);const d=structuredClone(raw);
  object(d,['name','type','package_version','schema_major','digest','license','source','permissions','inputs','outputs','preconditions','evidence','limits','verifier'],['name','type','package_version','schema_major','digest','license','source','permissions','inputs','outputs','preconditions','evidence','limits']);
  str(d.name,160);choice(d.type,['source_adapter','deliverable_renderer','channel_adapter','verifier_profile']);str(d.package_version,96);integer(d.schema_major,1,32);sha(d.digest);str(d.license,128);str(d.source,2048);
  array(d.permissions,16).forEach(p=>choice(p,['read','edit','capture','review','publish']));ensure(new Set(d.permissions).size===d.permissions.length,'Duplicate extension permission');
  for(const key of ['inputs','outputs','preconditions','evidence'])array(d[key],32).forEach(v=>str(v,160));
  object(d.limits,['max_input_bytes','max_output_bytes','timeout_seconds'],['max_input_bytes','max_output_bytes','timeout_seconds']);
  integer(d.limits.max_input_bytes,1,67108864);integer(d.limits.max_output_bytes,1,67108864);integer(d.limits.timeout_seconds,1,3600);
  if(d.type==='verifier_profile'){
    ensure(d.permissions.includes('review'),'Verifier requires review permission');
    ensure(d.verifier&&typeof d.verifier==='object'&&!Array.isArray(d.verifier),'Verifier policy required');
    const verifier=d.verifier,dimensions=['format','semantic','editorial','privacy','rights','accessibility','product-evidence','permissions'];
    object(verifier,['dimensions','authority','model','negative_controls','negative_control_cases','coverage_mode'],['dimensions','authority','negative_controls','negative_control_cases','coverage_mode']);
    array(verifier.dimensions,dimensions.length).forEach(value=>choice(value,dimensions));
    ensure(verifier.dimensions.length>0&&new Set(verifier.dimensions).size===verifier.dimensions.length,'Invalid verifier dimensions');
    choice(verifier.authority,['canonical','independent','human','heuristic']);
    if(verifier.model!==undefined)str(verifier.model,160);
    ensure(typeof verifier.negative_controls==='boolean','Invalid negative_controls');
    const controls=verifier.negative_control_cases,controlFields=['id','dimension','kind','fixture_sha256','expected_outcome'],controlKinds=['wrong-screen','wrong-price','frozen-video','stale-caption','custom-benign'];
    array(controls,32).forEach(control=>{
      object(control,controlFields,controlFields);str(control.id,96);ensure(/^[a-z][a-z0-9_.-]{0,95}$/.test(control.id),'Invalid control ID');
      choice(control.dimension,dimensions);choice(control.kind,controlKinds);sha(control.fixture_sha256);ensure(control.expected_outcome==='DETECTED','Invalid control outcome');
    });
    ensure(new Set(controls.map(control=>control.id)).size===controls.length,'Duplicate control ID');
    ensure(verifier.negative_controls===(controls.length>0),'Negative-control declaration mismatch');
    choice(verifier.coverage_mode,['complete','sampled']);
  }else ensure(d.verifier===undefined,'Verifier policy type mismatch');
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
