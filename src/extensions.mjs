// SPDX-License-Identifier: AGPL-3.0-only
import { integer, object, requireCondition as ensure, sameVersion, validateValue } from '@semwright/native-sdk';
import { KINDS, inputObject, str, lines, array, choice, sha, noSecrets } from './contracts.mjs';
import { OPERATION_SCOPES } from './operations.mjs';
import { iso } from './base.mjs';
export { PROFILE_MATRIX } from './source-profiles.mjs';

export const EXTENSION_TYPES=Object.freeze(['source_adapter','deliverable_renderer','channel_adapter','verifier_profile']);

function declarativeNamespace(value){
  validateValue(value);
  const bytes=Buffer.byteLength(JSON.stringify(value));
  ensure(bytes<=16384,'Extension namespace exceeds 16 KiB');
  const visit=(node,depth=0)=>{
    ensure(depth<=8,'Extension namespace nesting exceeds limit');
    if(Array.isArray(node)){ensure(node.length<=128,'Extension namespace array exceeds limit');for(const item of node)visit(item,depth+1);return;}
    if(node&&typeof node==='object'){
      const entries=Object.entries(node);ensure(entries.length<=128,'Extension namespace object exceeds limit');
      for(const [key,item] of entries){
        ensure(!/(^|[_-])(html|javascript|script|grant|grants|credential|credentials|token|secret)([_-]|$)/i.test(key),'Extension namespaces cannot declare presentation code, grants or credentials');
        visit(item,depth+1);
      }
      return;
    }
    if(typeof node==='string')ensure(!/<script\b|javascript:/i.test(node),'Extension namespace contains executable presentation content');
  };
  visit(value);
}

function validateRights(rights,packageLicense){
  object(rights,['owner','package_license','redistribution','notices','third_party'],['package_license','redistribution','notices','third_party']);
  if(rights.owner!==undefined)str(rights.owner,160);
  str(rights.package_license,128);ensure(rights.package_license===packageLicense,'Rights package license must match extension license');
  choice(rights.redistribution,['allowed','restricted','metadata-only','forbidden']);
  array(rights.notices,64).forEach(v=>str(v,1000));
  array(rights.third_party,64).forEach(item=>{
    object(item,['name','license','source','digest','redistribution','notice'],['name','license','source','redistribution']);
    str(item.name,160);str(item.license,128);str(item.source,2048);choice(item.redistribution,['allowed','restricted','metadata-only','forbidden']);
    if(item.digest!==undefined)sha(item.digest);if(item.notice!==undefined)str(item.notice,1000);
  });
}

function validateRenderer(renderer){
  object(renderer,['fidelity','equivalent','preserved_relations','lost_relations','constraints'],['fidelity','equivalent','preserved_relations','lost_relations','constraints']);
  choice(renderer.fidelity,['exact','bounded-loss','incompatible']);ensure(typeof renderer.equivalent==='boolean','Renderer equivalent must be boolean');
  for(const key of ['preserved_relations','lost_relations','constraints'])array(renderer[key],64).forEach(v=>str(v,240));
  ensure(new Set(renderer.preserved_relations).size===renderer.preserved_relations.length,'Duplicate preserved renderer relation');
  ensure(new Set(renderer.lost_relations).size===renderer.lost_relations.length,'Duplicate lost renderer relation');
  if(renderer.lost_relations.length)ensure(renderer.equivalent===false&&renderer.fidelity!=='exact','Renderer cannot claim equivalence after losing a relation');
  if(renderer.fidelity==='exact')ensure(renderer.equivalent===true&&renderer.lost_relations.length===0,'Exact renderer fidelity requires equivalence and zero lost relations');
  if(renderer.fidelity==='incompatible')ensure(renderer.equivalent===false,'Incompatible renderer cannot claim equivalence');
}

export function validateExtensionManifest(raw){
  validateValue(raw);noSecrets(raw);const d=structuredClone(raw);
  object(d,['name','type','package_version','schema_major','digest','license','source','permissions','inputs','outputs','preconditions','evidence','limits','verifier','rights','renderer','namespaces','deprecation'],['name','type','package_version','schema_major','digest','license','source','permissions','inputs','outputs','preconditions','evidence','limits']);
  str(d.name,160);choice(d.type,EXTENSION_TYPES);str(d.package_version,96);integer(d.schema_major,1,32);sha(d.digest);str(d.license,128);str(d.source,2048);
  array(d.permissions,16).forEach(p=>choice(p,['read','edit','capture','review','publish']));ensure(new Set(d.permissions).size===d.permissions.length,'Duplicate extension permission');
  for(const key of ['inputs','outputs','preconditions','evidence'])array(d[key],32).forEach(v=>str(v,160));
  object(d.limits,['max_input_bytes','max_output_bytes','timeout_seconds'],['max_input_bytes','max_output_bytes','timeout_seconds']);
  integer(d.limits.max_input_bytes,1,67108864);integer(d.limits.max_output_bytes,1,67108864);integer(d.limits.timeout_seconds,1,3600);
  if(d.rights!==undefined)validateRights(d.rights,d.license);
  if(d.namespaces!==undefined){
    ensure(d.namespaces&&typeof d.namespaces==='object'&&!Array.isArray(d.namespaces),'Extension namespaces must be an object');
    const entries=Object.entries(d.namespaces);ensure(entries.length<=16,'Too many extension namespaces');
    for(const [name,value] of entries){ensure(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(name),'Invalid extension namespace');declarativeNamespace(value);}
  }
  if(d.deprecation!==undefined){
    object(d.deprecation,['state','replacement','message'],['state']);choice(d.deprecation.state,['active','deprecated']);
    if(d.deprecation.replacement!==undefined)str(d.deprecation.replacement,160);if(d.deprecation.message!==undefined)str(d.deprecation.message,1000);
  }
  if(d.type==='deliverable_renderer'){if(d.renderer!==undefined)validateRenderer(d.renderer);}else ensure(d.renderer===undefined,'Renderer fidelity policy type mismatch');
  if(d.type==='verifier_profile'){
    ensure(d.permissions.includes('review'),'Verifier requires review permission');
    ensure(d.verifier&&typeof d.verifier==='object'&&!Array.isArray(d.verifier),'Verifier policy required');
    const verifier=d.verifier,dimensions=['format','semantic','editorial','privacy','rights','accessibility','product-evidence','permissions'];
    object(verifier,['dimensions','authority','model','negative_controls','negative_control_cases','coverage_mode'],['dimensions','authority','negative_controls','negative_control_cases','coverage_mode']);
    array(verifier.dimensions,dimensions.length).forEach(value=>choice(value,dimensions));
    ensure(verifier.dimensions.length>0&&new Set(verifier.dimensions).size===verifier.dimensions.length,'Invalid verifier dimensions');
    choice(verifier.authority,['canonical','independent','human','heuristic']);if(verifier.model!==undefined)str(verifier.model,160);
    ensure(typeof verifier.negative_controls==='boolean','Invalid negative_controls');
    const controls=verifier.negative_control_cases,controlFields=['id','dimension','kind','fixture_sha256','expected_outcome'],controlKinds=['wrong-screen','wrong-price','frozen-video','stale-caption','custom-benign'];
    array(controls,32).forEach(control=>{
      object(control,controlFields,controlFields);str(control.id,96);ensure(/^[a-z][a-z0-9_.-]{0,95}$/.test(control.id),'Invalid control ID');
      choice(control.dimension,dimensions);choice(control.kind,controlKinds);sha(control.fixture_sha256);ensure(control.expected_outcome==='DETECTED','Invalid control outcome');
    });
    ensure(new Set(controls.map(control=>control.id)).size===controls.length,'Duplicate control ID');
    ensure(verifier.negative_controls===(controls.length>0),'Negative-control declaration mismatch');choice(verifier.coverage_mode,['complete','sampled']);
  }else ensure(d.verifier===undefined,'Verifier policy type mismatch');
  return d;
}

export function genericExtensionView(entity){
  const d=entity.data;
  return{schema_version:'launchwright-extension-generic-view/1',id:entity.id,version:entity.version,name:d.name,type:d.type,package_version:d.package_version,schema_major:d.schema_major,digest:d.digest,license:d.license,status:d.status,
    properties:{schema_major:d.schema_major,digest:d.digest,license:d.license,source:d.source,permissions:d.permissions,inputs:d.inputs,outputs:d.outputs,preconditions:d.preconditions,evidence:d.evidence,limits:d.limits,namespaces:d.namespaces??{}},
    renderer:d.renderer??null,verifier:d.verifier??null,rights:d.rights??null,deprecation:d.deprecation??{state:'active'},actions_allowed:d.status==='active'?['compatibility.lock']:[],
    presentation_code_executable:false,remote_code_executable:false,authority_grants_from_descriptor:false};
}

export function validateCompatibilityLock(raw){
  validateValue(raw);noSecrets(raw);const d=structuredClone(raw);
  object(d,['product_id','name','components','notes','rehearsal_of_id'],['product_id','name','components']);str(d.product_id,128);str(d.name,160);
  array(d.components,64).forEach(c=>{object(c,['kind','name','version','digest','resource_id'],['kind','name','version']);choice(c.kind,['native-sdk','platform-client','source-adapter','renderer','channel-adapter','channel-profile','verifier','template']);str(c.name,160);str(c.version,128);if(c.digest)sha(c.digest);if(c.resource_id)str(c.resource_id,128);});
  ensure(new Set(d.components.map(c=>c.kind+'|'+c.name)).size===d.components.length,'Duplicate compatibility component');
  if(d.notes!==undefined)lines(d.notes,8000);if(d.rehearsal_of_id!==undefined)str(d.rehearsal_of_id,128);
  return d;
}

export function extensionDiscovery(app,input){
  inputObject(input,['type','include_retired'],[]);if(input.type!==undefined)choice(input.type,EXTENSION_TYPES);if(input.include_retired!==undefined)ensure(typeof input.include_retired==='boolean','include_retired must be boolean');
  const locks=app.list('compatibility_lock');
  const items=app.list('extension_package').filter(e=>(!input.type||e.data.type===input.type)&&(input.include_retired||e.data.status==='active')).map(e=>{
    const affected=locks.filter(lock=>lock.data.components.some(c=>c.resource_id===e.id)).map(lock=>lock.id);
    return{...genericExtensionView(e),affected_compatibility_lock_ids:affected,admission:e.data.admission};
  });
  return{schema_version:'launchwright-extension-discovery/2',items,remote_code_execution:false,platform_registry_authority:false,generic_view_schema:'launchwright-extension-generic-view/1'};
}

export function compatibilityNegotiate(app,input){
  inputObject(input,['schema_major','operations','kinds'],['schema_major']);integer(input.schema_major,1,32);
  const operations=input.operations??[],kinds=input.kinds??[];array(operations,128).forEach(v=>str(v,160));array(kinds,128).forEach(v=>str(v,160));
  const supportedOps=new Set(Object.keys(OPERATION_SCOPES)),supportedKinds=new Set(KINDS),unsupportedOperations=operations.filter(v=>!supportedOps.has(v)),unsupportedKinds=kinds.filter(v=>!supportedKinds.has(v));
  const majorOk=input.schema_major===1;
  return{schema_major:1,requested_schema_major:input.schema_major,compatible:majorOk,unsupported_operations:unsupportedOperations,unsupported_kinds:unsupportedKinds,
    diagnostics:[...(!majorOk?[{code:'SCHEMA_MAJOR_UNSUPPORTED',behavior:'reject'}]:[]),...unsupportedOperations.map(name=>({code:'OPERATION_UNSUPPORTED',name,behavior:'unsupported'})),...unsupportedKinds.map(name=>({code:'KIND_UNSUPPORTED',name,behavior:'unsupported'}))],
    supported_optional:{extensions:true,localization:true,channel_packages:true,portable_snapshots:true,durable_history:!!app.store?.hasHistory},major_mismatch_behavior:'reject'};
}

export function compatibilityInspect(app,id){
  const lock=app.get(id,'compatibility_lock');
  const components=lock.data.components.map(c=>{
    if(!c.resource_id)return{...c,state:'DECLARED',observed:null};
    let r;try{r=app.get(c.resource_id);}catch{return{...c,state:'MISSING',observed:null};}
    if(r.kind==='tombstone')return{...c,state:'RETIRED',observed:{kind:r.kind,version:r.version}};
    let observedVersion=r.version.revision,observedDigest=null;
    if(r.kind==='extension_package'){observedVersion=r.data.package_version;observedDigest=r.data.digest;if(r.data.status==='retired')return{...c,state:'RETIRED',observed:{kind:r.kind,version:observedVersion,digest:observedDigest,resource_version:r.version}};}
    if(r.kind==='channel_profile')observedVersion=r.data.profile_version;
    const versionMatch=observedVersion===c.version,digestMatch=!c.digest||observedDigest===c.digest;
    return{...c,state:versionMatch&&digestMatch?'CURRENT':'DRIFT',observed:{kind:r.kind,version:observedVersion,digest:observedDigest,resource_version:r.version}};
  });
  return{lock,components,state:components.some(c=>['MISSING','RETIRED','DRIFT'].includes(c.state))?'DRIFT':'CURRENT',authority:'application-compatibility-lock-only',rehearsal_required_on_change:true,rehearsal:lock.data.rehearsal??null};
}

export function registerExtension(app,input){
  const data=validateExtensionManifest(input);ensure(data.schema_major===1,'Unsupported extension schema major','ProtocolMismatch');
  const duplicate=app.list('extension_package').find(e=>e.data.type===data.type&&e.data.name===data.name&&e.data.package_version===data.package_version&&e.data.status==='active');ensure(!duplicate,'This extension version is already registered','Conflict');
  return{entity:app.store.create('extension_package',{...data,status:'active',admission:'local-descriptor-only',remote_code_executable:false,registered_by:app.principal,registered_at:iso()})};
}

export function retireExtension(app,input){
  inputObject(input,['id','expected','reason']);const ext=app.get(input.id,'extension_package');ensure(sameVersion(ext.version,input.expected),'Extension revision changed','StaleReference');ensure(ext.data.status==='active','Extension is already retired','Conflict');lines(input.reason,4000);
  const affected=app.list('compatibility_lock').filter(lock=>lock.data.components.some(c=>c.resource_id===ext.id)).map(lock=>lock.id);
  const entity=app.store.update(ext.id,{...ext.data,status:'retired',retired_by:app.principal,retired_at:iso(),retire_reason:input.reason,new_use_allowed:false,affected_compatibility_lock_ids:affected});
  return{entity,affected_compatibility_lock_ids:affected,prior_attempts_preserved:true,automatic_rerun:false};
}

function componentDiff(previous,next){
  const key=c=>c.kind+'|'+c.name,old=new Map(previous.map(c=>[key(c),c])),fresh=new Map(next.map(c=>[key(c),c])),keys=[...new Set([...old.keys(),...fresh.keys()])].sort(),changes=[];
  for(const k of keys){const a=old.get(k),b=fresh.get(k);if(!a||!b||a.version!==b.version||(a.digest??null)!==(b.digest??null)||(a.resource_id??null)!==(b.resource_id??null))changes.push({component:k,before:a??null,after:b??null});}
  return changes;
}

export function createCompatibilityLock(app,input){
  const data=validateCompatibilityLock(input),product=app.get(data.product_id,'product');
  const components=data.components.map(c=>{
    if(!c.resource_id)return{...c,resource_version:null};const r=app.get(c.resource_id);
    if(r.kind!=='extension_package')ensure(app.productOf(r)===product.id,'Compatibility component belongs to another product','PermissionDenied');
    if(r.kind==='extension_package')ensure(r.data.status==='active','Cannot lock a retired extension','Conflict');
    if(c.kind==='channel-profile')ensure(r.kind==='channel_profile','Compatibility component kind does not match resource');
    if(c.kind==='template')ensure(r.kind==='template','Compatibility component kind does not match resource');
    if(['source-adapter','renderer','channel-adapter','verifier'].includes(c.kind))ensure(r.kind==='extension_package','Compatibility component must reference an extension descriptor');
    return{...c,resource_version:r.version};
  });
  let rehearsal=null;
  if(data.rehearsal_of_id){
    const prior=app.get(data.rehearsal_of_id,'compatibility_lock');ensure(prior.data.product_id===product.id,'Rehearsal lock belongs to another product','PermissionDenied');
    rehearsal={schema_version:'launchwright-compatibility-rehearsal/1',from_lock_id:prior.id,from_lock_version:prior.version,previous_state:compatibilityInspect(app,prior.id).state,changed_components:componentDiff(prior.data.components,components),evidence_reused:false,inherited_passes:[],state:'REQUIRES_REVIEW'};
  }
  return{entity:app.store.create('compatibility_lock',{...data,components,product_version:product.version,created_by:app.principal,created_at:iso(),authority:'application-rehearsal-lock',...(rehearsal?{rehearsal}:{})})};
}
