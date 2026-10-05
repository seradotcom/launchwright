// SPDX-License-Identifier: AGPL-3.0-only
import { requireCondition as ensure, object, integer, sameVersion } from '@semwright/native-sdk';
import { inputObject, str, lines, array, choice, idText, locale, noSecrets, digest, iso } from './contracts.mjs';
import { preparePublicationWork } from './publish-work.mjs';

const SOURCE_TYPES=['web','cli','mobile-import','godot','document'];
const OUTPUTS=['artifact','media-video','media-screenshots','media-interactive','channel-package'];
const VERIFY_DIMENSIONS=['format','semantic','editorial','privacy','rights','accessibility','product-evidence','permissions'];
const AUDIENCES=['private','invited','organization'];
const PARAM_TYPES=['text','choice','resource'];
const RESOURCE_PARAM_KINDS=['source','scenario','claim'];
const FORBIDDEN_PARAMETER_NAME=/(?:url|uri|path|shell|command|script|credential|secret|token|password|cookie)/i;
const CONTRACT_FIELDS=Object.freeze(['product_id','release_id','name','description','source_types','source_ids','scenario_ids','protected_scenario_ids','claim_ids','locales','destinations','outputs','parameters','verification_dimensions','budget','audience','external_disclosures','export_resource_ids','result_retention']);
const contractOnly=data=>Object.fromEntries(CONTRACT_FIELDS.map(key=>[key,structuredClone(data[key])]));

function unique(values,message='Duplicate values are not permitted'){
  ensure(new Set(values).size===values.length,message);
  return values;
}
function boolean(value,message){ensure(typeof value==='boolean',message);return value;}
function boundedBudget(raw){
  object(raw,['max_cost_microunits','currency','max_runtime_seconds'],['max_cost_microunits','currency','max_runtime_seconds']);
  integer(raw.max_cost_microunits,0,1000000000);str(raw.currency,8);integer(raw.max_runtime_seconds,1,3600);
  return structuredClone(raw);
}
function retained(raw){
  object(raw,['mode','days'],['mode']);choice(raw.mode,['preserve','ttl']);
  if(raw.mode==='ttl')integer(raw.days,1,3650);else ensure(raw.days===undefined,'Preserve retention does not accept days');
  return structuredClone(raw);
}
function sameProduct(app,entity,productId,releaseId=null){
  ensure(app.productOf(entity)===productId,'ReleaseTemplate reference belongs to another product','PermissionDenied');
  if(releaseId&&entity.data.release_id)ensure(entity.data.release_id===releaseId,'ReleaseTemplate reference belongs to another release','PermissionDenied');
  return entity;
}
function ids(values,max=64){
  array(values,max).forEach(idText);return unique(values);
}
function safeTextParameter(value,max){
  str(value,max);
  ensure(!/^[a-z][a-z0-9+.-]*:\/\//i.test(value),'URL parameters are outside this ReleaseTemplate scope','PermissionDenied');
  ensure(!/^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(value),'Filesystem paths are outside this ReleaseTemplate scope','PermissionDenied');
  return value;
}
function validateParameterDefinitions(app,defs,{productId,releaseId,sourceIds,scenarioIds,claimIds}){
  array(defs,32);unique(defs.map(p=>p?.name),'Duplicate ReleaseTemplate parameter');
  const selected={source:new Set(sourceIds),scenario:new Set(scenarioIds),claim:new Set(claimIds)};
  return defs.map(raw=>{
    object(raw,['name','type','required','max_length','choices','resource_kind','options'],['name','type','required']);
    const name=str(raw.name,64);ensure(/^[a-z][a-z0-9_]*$/.test(name),'Invalid ReleaseTemplate parameter name');
    ensure(!FORBIDDEN_PARAMETER_NAME.test(name),'URL/path/executable/credential parameters are outside this ReleaseTemplate scope','PermissionDenied');
    choice(raw.type,PARAM_TYPES);boolean(raw.required,'Parameter required must be boolean');
    if(raw.type==='text'){
      const max=integer(raw.max_length??1000,1,4000);
      ensure(raw.choices===undefined&&raw.resource_kind===undefined&&raw.options===undefined,'Text parameter has incompatible fields');
      return{name,type:'text',required:raw.required,max_length:max};
    }
    if(raw.type==='choice'){
      ensure(raw.max_length===undefined&&raw.resource_kind===undefined&&raw.options===undefined,'Choice parameter has incompatible fields');
      const choices=array(raw.choices,64).map(v=>str(v,256));ensure(choices.length>0,'Choice parameter requires choices');unique(choices);
      return{name,type:'choice',required:raw.required,choices};
    }
    ensure(raw.max_length===undefined&&raw.choices===undefined,'Resource parameter has incompatible fields');
    choice(raw.resource_kind,RESOURCE_PARAM_KINDS);const options=array(raw.options,64);ensure(options.length>0,'Resource parameter requires options');
    const seen=new Set(),out=options.map(option=>{
      object(option,['value','resource_id'],['value','resource_id']);const value=str(option.value,128);ensure(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value),'Invalid resource option value');ensure(!seen.has(value),'Duplicate resource option value');seen.add(value);
      const resourceId=idText(option.resource_id);ensure(selected[raw.resource_kind].has(resourceId),'Resource option is outside the template allowlist','PermissionDenied');
      const entity=sameProduct(app,app.get(resourceId,raw.resource_kind),productId,releaseId);
      return{value,resource_id:entity.id};
    });
    return{name,type:'resource',required:raw.required,resource_kind:raw.resource_kind,options:out};
  });
}
export function validateReleaseTemplate(app,raw){
  inputObject(raw,[
    'product_id','release_id','name','description','source_types','source_ids','scenario_ids','protected_scenario_ids','claim_ids',
    'locales','destinations','outputs','parameters','verification_dimensions','budget','audience','external_disclosures','export_resource_ids','result_retention'
  ],[
    'product_id','release_id','name','source_types','source_ids','scenario_ids','protected_scenario_ids','claim_ids',
    'locales','destinations','outputs','parameters','verification_dimensions','budget','audience','external_disclosures','export_resource_ids','result_retention'
  ]);
  noSecrets(raw);const product=app.get(idText(raw.product_id),'product'),release=app.get(idText(raw.release_id),'release');
  ensure(release.data.product_id===product.id,'ReleaseTemplate release belongs to another product','PermissionDenied');
  const sourceTypes=array(raw.source_types,8).map(v=>choice(v,SOURCE_TYPES));ensure(sourceTypes.length>0,'At least one source type is required');unique(sourceTypes);
  const sourceIds=ids(raw.source_ids),scenarioIds=ids(raw.scenario_ids),protectedIds=ids(raw.protected_scenario_ids),claimIds=ids(raw.claim_ids),exportIds=ids(raw.export_resource_ids);
  ensure(protectedIds.every(id=>scenarioIds.includes(id)),'Protected scenarios must be part of the scenario allowlist');
  const sources=sourceIds.map(id=>sameProduct(app,app.get(id,'source'),product.id));for(const source of sources)ensure(sourceTypes.includes(source.data.type),'Source type is outside ReleaseTemplate source_types');
  scenarioIds.forEach(id=>sameProduct(app,app.get(id,'scenario'),product.id,release.id));
  claimIds.forEach(id=>sameProduct(app,app.get(id,'claim'),product.id,release.id));
  const allowedExport=new Set([...sourceIds,...scenarioIds,...claimIds]);
  ensure(exportIds.every(id=>allowedExport.has(id)),'Only explicitly selected source/scenario/claim pins may be exported','PermissionDenied');
  const locales=array(raw.locales,32).map(locale);ensure(locales.length>0,'At least one locale is required');unique(locales);
  const destinations=array(raw.destinations,32).map(v=>{str(v,96);ensure(/^[a-z][a-z0-9_.:-]{0,95}$/.test(v),'Invalid destination key');return v;});ensure(destinations.length>0,'At least one destination is required');unique(destinations);
  const outputs=array(raw.outputs,16).map(v=>choice(v,OUTPUTS));ensure(outputs.length>0,'At least one output is required');unique(outputs);
  const dimensions=array(raw.verification_dimensions,16).map(v=>choice(v,VERIFY_DIMENSIONS));ensure(dimensions.length>0,'At least one verification dimension is required');unique(dimensions);
  const disclosures=array(raw.external_disclosures,32).map(v=>lines(v,1000));
  choice(raw.audience,AUDIENCES);
  const parameters=validateParameterDefinitions(app,raw.parameters,{productId:product.id,releaseId:release.id,sourceIds,scenarioIds,claimIds});
  return{
    product_id:product.id,release_id:release.id,name:str(raw.name,160),description:raw.description?lines(raw.description,6000):'',
    source_types:sourceTypes,source_ids:sourceIds,scenario_ids:scenarioIds,protected_scenario_ids:protectedIds,claim_ids:claimIds,
    locales,destinations,outputs,parameters,verification_dimensions:dimensions,budget:boundedBudget(raw.budget),audience:raw.audience,
    external_disclosures:disclosures,export_resource_ids:exportIds,result_retention:retained(raw.result_retention)
  };
}
function pinTemplate(app,template){
  const d=template.data,ids=[d.release_id,...d.source_ids,...d.scenario_ids,...d.claim_ids,...d.export_resource_ids];
  const entities=[template,...ids.map(id=>app.get(id))];
  return [...new Map(entities.map(entity=>[entity.id,{id:entity.id,kind:entity.kind,version:entity.version}])).values()].sort((a,b)=>a.id.localeCompare(b.id));
}
function publicParameters(parameters){
  return parameters.map(p=>p.type==='resource'?{name:p.name,type:p.type,required:p.required,resource_kind:p.resource_kind,options:p.options.map(o=>({value:o.value}))}:structuredClone(p));
}
function publicContract(contract){
  return{
    name:contract.name,description:contract.description,source_types:[...contract.source_types],locales:[...contract.locales],destinations:[...contract.destinations],
    outputs:[...contract.outputs],parameters:publicParameters(contract.parameters),verification_dimensions:[...contract.verification_dimensions],
    budget:structuredClone(contract.budget),audience:contract.audience,external_disclosures:[...contract.external_disclosures],result_retention:structuredClone(contract.result_retention)
  };
}
export function createReleaseTemplate(app,input){
  inputObject(input,['data']);const data=validateReleaseTemplate(app,input.data);
  return{entity:app.store.create('release_template',{...data,state:'DRAFT',created_by:app.principal,created_at:iso()})};
}
export function updateReleaseTemplate(app,input){
  inputObject(input,['id','expected','data']);const prior=app.get(input.id,'release_template');ensure(sameVersion(prior.version,input.expected),'ReleaseTemplate revision changed','StaleReference');
  const data=validateReleaseTemplate(app,input.data);ensure(prior.data.product_id===data.product_id&&prior.data.release_id===data.release_id,'ReleaseTemplate product/release identity is immutable','Conflict');
  const importOrigin=prior.data.import_origin?{...prior.data.import_origin,reverification_required:true,contract_recheck:'REQUIRED_AFTER_EDIT'}:undefined;
  return{entity:app.store.update(prior.id,{...data,state:'DRAFT',created_by:prior.data.created_by,created_at:prior.data.created_at,updated_by:app.principal,updated_at:iso(),...(importOrigin?{import_origin:importOrigin}:{})})};
}
export function freezeProductVersion(app,input){
  inputObject(input,['template_id','template_version','version_label']);const template=app.get(input.template_id,'release_template');
  ensure(sameVersion(template.version,input.template_version),'ReleaseTemplate revision changed','StaleReference');str(input.version_label,96);
  ensure(!template.data.import_origin?.reverification_required,'Imported ReleaseTemplate requires local rebind/recheck before versioning','PolicyDenied');
  const pins=pinTemplate(app,template),contract=contractOnly(template.data),versionPayload={template_id:template.id,template_version:template.version,version_label:input.version_label,contract,pins};
  const productVersionDigest=digest('product-version',versionPayload);
  const duplicate=app.list('product_version').find(v=>v.data.product_id===template.data.product_id&&v.data.version_label===input.version_label);
  ensure(!duplicate,'ProductVersion label already exists for this product','Conflict');
  return{entity:app.store.create('product_version',{
    product_id:template.data.product_id,release_id:template.data.release_id,name:template.data.name+' · '+input.version_label,version_label:input.version_label,
    release_template_id:template.id,release_template_version:template.version,contract,pins,product_version_digest:productVersionDigest,
    state:'FROZEN',immutable:true,platform_publish_authority:'EXTERNAL',created_by:app.principal,created_at:iso()
  })};
}
export function createDeployment(app,input){
  inputObject(input,['product_version_id','name']);const version=app.get(input.product_version_id,'product_version');str(input.name,160);
  const payload={product_version_id:version.id,product_version_digest:version.data.product_version_digest,name:input.name};
  return{entity:app.store.create('publish_deployment',{
    product_id:version.data.product_id,release_id:version.data.release_id,name:input.name,product_version_id:version.id,product_version_digest:version.data.product_version_digest,
    deployment_digest:digest('publish-deployment',payload),state:'ACTIVE',new_invocations_allowed:true,external_state:'NOT_SENT',
    result_retention:structuredClone(version.data.contract.result_retention),created_by:app.principal,created_at:iso()
  })};
}
export function transitionDeployment(app,input){
  inputObject(input,['id','expected','state','reason']);const deployment=app.get(input.id,'publish_deployment');ensure(sameVersion(deployment.version,input.expected),'Deployment revision changed','StaleReference');
  choice(input.state,['DEPRECATED','RETIRED']);lines(input.reason,4000);
  ensure(deployment.data.state!=='RETIRED','Retired deployment cannot transition again','Conflict');
  if(deployment.data.state==='DEPRECATED')ensure(input.state==='RETIRED','Deprecated deployment can only be retired','Conflict');
  return{entity:app.store.update(deployment.id,{...deployment.data,state:input.state,new_invocations_allowed:input.state!=='RETIRED',lifecycle_reason:input.reason,lifecycle_by:app.principal,lifecycle_at:iso()})};
}
function validateInvocationParameters(version,raw){
  object(raw);noSecrets(raw);const defs=version.data.contract.parameters,allowed=new Set(defs.map(p=>p.name));
  ensure(Object.keys(raw).every(k=>allowed.has(k)),'Invocation contains a parameter outside ProductVersion scope','PermissionDenied');
  const normalized={},resolved={};
  for(const def of defs){
    const present=Object.hasOwn(raw,def.name);if(def.required)ensure(present,'Missing required invocation parameter: '+def.name);if(!present)continue;
    const value=raw[def.name];
    if(def.type==='text'){ensure(typeof value==='string','Text parameter must be a string');normalized[def.name]=safeTextParameter(value,def.max_length);resolved[def.name]=normalized[def.name];}
    else if(def.type==='choice'){ensure(typeof value==='string'&&def.choices.includes(value),'Choice parameter is outside ProductVersion scope','PermissionDenied');normalized[def.name]=value;resolved[def.name]=value;}
    else{ensure(typeof value==='string','Resource parameter must use its public option value');const option=def.options.find(o=>o.value===value);ensure(option,'Resource parameter is outside ProductVersion scope','PermissionDenied');normalized[def.name]=value;resolved[def.name]=option.resource_id;}
  }
  return{normalized,resolved};
}
function invocationWork(app,invocation,budget){
  const bound=preparePublicationWork(app,'publish.invoke',{invocation_id:invocation.id},{allowInvoke:true});
  return app.store.create('work',{
    release_id:invocation.data.release_id,name:'Publish invocation · '+invocation.data.invocation_key,action:'publish.invoke',arguments:bound.arguments,budget,
    authorization:'consumer-invocation',publication_binding:bound.publication_binding,
    state:'PREPARED',authority:'platform-publish-required',budget_enforced:false,platform_job_id:null,pending_digest:null
  });
}
export function prepareInvocation(app,input){
  inputObject(input,['deployment_id','invocation_key','parameters','budget','requested_outputs'],['deployment_id','invocation_key','parameters','budget']);
  const deployment=app.get(input.deployment_id,'publish_deployment');ensure(deployment.data.new_invocations_allowed===true&&deployment.data.state!=='RETIRED','Deployment is retired; new invocations are blocked','Conflict');
  const version=app.get(deployment.data.product_version_id,'product_version');const key=str(input.invocation_key,128);ensure(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(key),'Invalid invocation key');
  const budget=boundedBudget(input.budget),ceiling=version.data.contract.budget;ensure(budget.currency===ceiling.currency,'Invocation currency differs from ProductVersion budget');ensure(budget.max_cost_microunits<=ceiling.max_cost_microunits&&budget.max_runtime_seconds<=ceiling.max_runtime_seconds,'Invocation budget exceeds ProductVersion ceiling','PolicyDenied');
  const params=validateInvocationParameters(version,input.parameters);
  const requested=input.requested_outputs??version.data.contract.outputs;array(requested,16).forEach(v=>choice(v,version.data.contract.outputs));unique(requested);ensure(requested.length>0,'Invocation must request at least one allowed output');
  const intent={deployment_id:deployment.id,product_version_id:version.id,consumer:app.principal,invocation_key:key,parameters:params.normalized,requested_outputs:requested,budget};
  const invocationDigest=digest('publish-invocation',intent);
  const prior=app.list('publish_invocation').find(row=>row.data.consumer===app.principal&&row.data.deployment_id===deployment.id&&row.data.invocation_key===key);
  if(prior){
    ensure(prior.data.invocation_digest===invocationDigest,'Invocation key is already bound to different input','Conflict');
    const work=findInvocationWork(app,prior);return{entity:prior,work,deduplicated:true};
  }
  const created=app.store.create('publish_invocation',{
    product_id:deployment.data.product_id,release_id:deployment.data.release_id,name:'Invocation · '+key,deployment_id:deployment.id,deployment_digest:deployment.data.deployment_digest,
    product_version_id:version.id,product_version_digest:version.data.product_version_digest,consumer:app.principal,invocation_key:key,parameters:params.normalized,resolved_parameters:params.resolved,
    requested_outputs:requested,budget,invocation_digest:invocationDigest,state:'PREPARED',platform_authority:'EXTERNAL',created_at:iso()
  });
  const work=invocationWork(app,created,budget);
  return{entity:created,work,deduplicated:false};
}
function findInvocationWork(app,invocation){
  const works=app.list('work').filter(work=>work.data.publication_binding?.kind==='publish_invocation'&&work.data.publication_binding.id===invocation.id);
  ensure(works.length===1,'Publish invocation work binding is missing or ambiguous','Conflict');return works[0];
}
function safeVersion(version){
  return{id:version.id,version:version.version,version_label:version.data.version_label,name:version.data.name,product_version_digest:version.data.product_version_digest,contract:publicContract(version.data.contract),state:version.data.state};
}
export function inspectPublish(app,input){
  inputObject(input,['deployment_id','product_version_id','invocation_id'],[]);
  const selected=[input.deployment_id,input.product_version_id,input.invocation_id].filter(Boolean);ensure(selected.length===1,'Provide exactly one publication locator');
  if(input.product_version_id)return{product_version:safeVersion(app.get(input.product_version_id,'product_version')),owner_resources_exposed:false};
  if(input.deployment_id){
    const deployment=app.get(input.deployment_id,'publish_deployment'),version=app.get(deployment.data.product_version_id,'product_version');
    return{deployment:{id:deployment.id,version:deployment.version,name:deployment.data.name,state:deployment.data.state,new_invocations_allowed:deployment.data.new_invocations_allowed,product_version_id:version.id,product_version_digest:version.data.product_version_digest,result_retention:deployment.data.result_retention},product_version:safeVersion(version),owner_resources_exposed:false};
  }
  const invocation=app.get(input.invocation_id,'publish_invocation');
  const ownerMayInspect=app.scopes?.has?.('publish')===true;ensure(invocation.data.consumer===app.principal||ownerMayInspect,'Invocation belongs to another consumer','PermissionDenied');
  const work=findInvocationWork(app,invocation);
  return{invocation:{id:invocation.id,version:invocation.version,consumer:invocation.data.consumer,invocation_key:invocation.data.invocation_key,deployment_id:invocation.data.deployment_id,product_version_id:invocation.data.product_version_id,parameters:invocation.data.parameters,requested_outputs:invocation.data.requested_outputs,budget:invocation.data.budget,invocation_digest:invocation.data.invocation_digest,state:work.data.state,platform_job_id:work.data.platform_job_id??null,result:work.data.result??null},owner_resources_exposed:false};
}
function exportManifest(version){
  const contract=version.data.contract,pins=version.data.pins.filter(pin=>contract.export_resource_ids.includes(pin.id));
  const payload={schema_version:'launchwright-release-template-export/1',source_product_version_digest:version.data.product_version_digest,version_label:version.data.version_label,
    template:{name:contract.name,description:contract.description,release_id:contract.release_id,source_types:contract.source_types,source_ids:contract.source_ids,scenario_ids:contract.scenario_ids,protected_scenario_ids:contract.protected_scenario_ids,claim_ids:contract.claim_ids,locales:contract.locales,destinations:contract.destinations,outputs:contract.outputs,parameters:contract.parameters,verification_dimensions:contract.verification_dimensions,budget:contract.budget,audience:contract.audience,external_disclosures:contract.external_disclosures,export_resource_ids:contract.export_resource_ids,result_retention:contract.result_retention},pins};
  return{...payload,export_digest:digest('release-template-export',payload),secrets_included:false,grants_included:false,permissions_included:false};
}
export function exportProductVersion(app,input){
  inputObject(input,['product_version_id']);const version=app.get(input.product_version_id,'product_version'),manifest=exportManifest(version);noSecrets(manifest);
  const bytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n'),sha256=app.store.blob(bytes,'application/json');
  return{entity:app.store.create('template_export',{product_id:version.data.product_id,release_id:version.data.release_id,name:'Template export · '+version.data.version_label,product_version_id:version.id,product_version_digest:version.data.product_version_digest,sha256,size_bytes:bytes.length,export_digest:manifest.export_digest,secrets_included:false,grants_included:false,permissions_included:false,created_by:app.principal,created_at:iso()}),manifest};
}
function remapContract(manifest,bindings,targetProduct,targetRelease){
  const source=structuredClone(manifest.template),map=id=>{const v=bindings[id];ensure(v,'Import is missing an explicit resource rebind for '+id,'Conflict');return v;};
  source.product_id=targetProduct.id;source.release_id=targetRelease.id;
  for(const field of ['source_ids','scenario_ids','protected_scenario_ids','claim_ids','export_resource_ids'])source[field]=source[field].map(map);
  source.parameters=source.parameters.map(p=>p.type==='resource'?{...p,options:p.options.map(o=>({...o,resource_id:map(o.resource_id)}))}:p);
  return source;
}
export function importProductVersion(app,input){
  inputObject(input,['product_id','release_id','name','manifest','bindings']);const product=app.get(input.product_id,'product'),release=app.get(input.release_id,'release');ensure(release.data.product_id===product.id,'Import target release belongs to another product','PermissionDenied');
  object(input.manifest);noSecrets(input.manifest);ensure(input.manifest.schema_version==='launchwright-release-template-export/1','Unsupported template export schema','ProtocolMismatch');
  const copy=structuredClone(input.manifest),exportDigest=copy.export_digest;delete copy.export_digest;delete copy.secrets_included;delete copy.grants_included;delete copy.permissions_included;
  ensure(exportDigest===digest('release-template-export',copy),'Template export digest differs','Conflict');ensure(input.manifest.secrets_included===false&&input.manifest.grants_included===false&&input.manifest.permissions_included===false,'Template export carries forbidden authority','PermissionDenied');
  object(input.bindings);for(const [from,to]of Object.entries(input.bindings)){idText(from);idText(to);}
  const rebound=remapContract(input.manifest,input.bindings,product,release);rebound.name=str(input.name,160);
  const validated=validateReleaseTemplate(app,rebound);
  const entity=app.store.create('release_template',{...validated,state:'DRAFT',created_by:app.principal,created_at:iso(),import_origin:{export_digest:input.manifest.export_digest,source_product_version_digest:input.manifest.source_product_version_digest,reverification_required:true,contract_recheck:'REQUIRED',bindings:structuredClone(input.bindings)}});
  return{entity,reverification_required:true};
}
export function rebindImportedTemplate(app,input){
  inputObject(input,['id','expected','acknowledge_contract_recheck']);const template=app.get(input.id,'release_template');ensure(sameVersion(template.version,input.expected),'Imported ReleaseTemplate revision changed','StaleReference');
  ensure(template.data.import_origin?.reverification_required===true,'ReleaseTemplate is not awaiting import recheck','Conflict');ensure(input.acknowledge_contract_recheck===true,'Explicit contract recheck acknowledgement is required','ConsentRequired');
  const raw=contractOnly(template.data);
  const validated=validateReleaseTemplate(app,raw);const importOrigin={...template.data.import_origin,reverification_required:false,contract_recheck:'APPLICATION_REBIND_RECHECKED',rechecked_by:app.principal,rechecked_at:iso(),canonical_runtime_verification:false};
  return{entity:app.store.update(template.id,{...validated,state:'DRAFT',created_by:template.data.created_by,created_at:template.data.created_at,updated_by:app.principal,updated_at:iso(),import_origin:importOrigin}),canonical_runtime_verification:false};
}
