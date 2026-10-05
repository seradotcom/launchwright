// SPDX-License-Identifier: AGPL-3.0-only
import { requireCondition as ensure, object, integer } from '@semwright/native-sdk';
import { inputObject, noSecrets, str, array, idText, digest, iso } from './contracts.mjs';

export const CANONICAL_GRAPH_READ_ACTIONS=Object.freeze(new Set([
  'project.query','project.asset.inspect','project.asset.provenance',
  'project.revisions','project.impact','project.manifest.export'
]));
export const CANONICAL_GRAPH_MUTATIONS=Object.freeze(new Set(['project.edge.declare']));
export const CANONICAL_GRAPH_ACTIONS=Object.freeze([
  ...CANONICAL_GRAPH_READ_ACTIONS,
  ...CANONICAL_GRAPH_MUTATIONS
]);
const GRAPH_RELATIONS=Object.freeze([
  'contains','references','derived_from','produced_by','consumed_by',
  'realizes','published_as','verified_by'
]);

function token(value,label,max=256){
  str(value,max);
  ensure(!/[\0-\x1f]/u.test(value),label+' contains control characters');
  return value;
}
function grantName(value){
  token(value,'Project Graph root grant',128);
  ensure(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value),'Project Graph root must be a named grant, never a filesystem path');
  return value;
}
function opaqueId(value,label){token(value,label,160);ensure(!/\s/u.test(value),label+' cannot contain whitespace');return value;}
function boundedObject(value,label,maxBytes=16384){
  object(value);noSecrets(value);
  ensure(Buffer.byteLength(JSON.stringify(value))<=maxBytes,label+' exceeds the bounded contract size','ResourceExhausted');
  return structuredClone(value);
}
function bindings(app,releaseId,raw){
  const release=app.get(releaseId,'release');
  const values=array(raw??[],128);
  ensure(values.length>0,'Canonical Project Graph work requires at least one exact local resource binding');
  const resources=values.map((entry,index)=>{
    inputObject(entry,['resource_id','asset'],['resource_id','asset']);
    const resource=app.get(idText(entry.resource_id));
    ensure(resource.kind!=='tombstone','Retired resources cannot be bound as current Graph inputs','Conflict');
    ensure(app.productOf(resource)===release.data.product_id,'Graph binding crosses product boundary','PermissionDenied');
    return{resource_id:resource.id,resource_kind:resource.kind,resource_version:resource.version,asset:opaqueId(entry.asset,'Project Graph asset '+index)};
  });
  ensure(new Set(resources.map(r=>r.resource_id)).size===resources.length,'Duplicate local resource Graph binding');
  ensure(new Set(resources.map(r=>r.asset)).size===resources.length,'One Graph asset cannot stand in for multiple local resources');
  return resources.sort((a,b)=>a.resource_id.localeCompare(b.resource_id));
}
function budget(raw){
  const value=raw??{nodes:256,edges:1024,depth:16,results:128};
  inputObject(value,['nodes','edges','depth','results'],['nodes','edges','depth','results']);
  integer(value.nodes,1,1000);integer(value.edges,1,5000);integer(value.depth,1,32);integer(value.results,1,256);
  return{nodes:value.nodes,edges:value.edges,depth:value.depth,results:value.results};
}
function makeBinding(releaseId,action,rootName,project,resources){
  const core={schema_version:'launchwright-project-graph-binding/1',release_id:releaseId,action,root:rootName,project,resources};
  return{...core,binding_sha256:digest('project-graph-binding',core)};
}
function checkBinding(app,binding){
  object(binding,['schema_version','release_id','action','root','project','resources','binding_sha256'],['schema_version','release_id','action','root','project','resources','binding_sha256']);
  ensure(binding.schema_version==='launchwright-project-graph-binding/1','Unsupported Project Graph binding schema','ProtocolMismatch');
  const {binding_sha256,...core}=binding;
  ensure(digest('project-graph-binding',core)===binding_sha256,'Project Graph work binding digest changed','Conflict');
  const pins=binding.resources.map(r=>({id:r.resource_id,version:r.resource_version}));
  return app.freshness(pins);
}

export function prepareGraphWork(app,releaseId,action,raw){
  ensure(CANONICAL_GRAPH_ACTIONS.includes(action),'Unsupported canonical Project Graph action','Unsupported');
  object(raw);noSecrets(raw);
  const allowed={
    'project.query':['root','project','query','limit','cursor','bindings'],
    'project.asset.inspect':['root','project','asset','bindings'],
    'project.asset.provenance':['root','project','asset','limit','bindings'],
    'project.revisions':['root','project','asset','after','limit','bindings'],
    'project.impact':['root','project','asset','budget','bindings'],
    'project.manifest.export':['root','project','assets','bindings'],
    'project.edge.declare':['root','project','from','to','relation','bindings']
  }[action];
  inputObject(raw,allowed,['root','project','bindings']);
  const rootName=grantName(raw.root),project=opaqueId(raw.project,'Project Graph project');
  const resources=bindings(app,releaseId,raw.bindings);
  const args={root:rootName,project};
  if(action==='project.query'){
    if(raw.query!==undefined)args.query=boundedObject(raw.query,'Project Graph query');
    const limit=raw.limit??50;integer(limit,1,128);args.limit=limit;
    if(raw.cursor!==undefined)args.cursor=token(raw.cursor,'Project Graph cursor',4096);
  }else if(['project.asset.inspect','project.asset.provenance','project.revisions','project.impact'].includes(action)){
    ensure(raw.asset!==undefined,'Project Graph asset is required');
    args.asset=opaqueId(raw.asset,'Project Graph asset');
    ensure(resources.some(r=>r.asset===args.asset),'Queried Graph asset must be bound to a visible local resource','PermissionDenied');
    if(action==='project.asset.provenance'){const limit=raw.limit??64;integer(limit,1,128);args.limit=limit;}
    if(action==='project.revisions'){
      const limit=raw.limit??50;integer(limit,1,128);args.limit=limit;
      if(raw.after!==undefined)args.after=opaqueId(raw.after,'Project Graph revision');
    }
    if(action==='project.impact')args.budget=budget(raw.budget);
  }else if(action==='project.manifest.export'){
    const assets=array(raw.assets??[],128).map((v,i)=>opaqueId(v,'Project Graph export asset '+i));
    ensure(assets.length>0&&new Set(assets).size===assets.length,'Project Graph export requires unique assets');
    const visible=new Set(resources.map(r=>r.asset));ensure(assets.every(v=>visible.has(v)),'Manifest export may include only locally bound visible assets','PermissionDenied');
    args.assets=assets;
  }else if(action==='project.edge.declare'){
    for(const field of ['from','to','relation'])ensure(raw[field]!==undefined,'Project Graph edge field '+field+' is required');
    args.from=opaqueId(raw.from,'Project Graph edge source');args.to=opaqueId(raw.to,'Project Graph edge target');
    ensure(args.from!==args.to,'Self-edge declarations require an explicit upstream Graph workflow and are not emitted by Launchwright');
    const visible=new Set(resources.map(r=>r.asset));ensure(visible.has(args.from)&&visible.has(args.to),'Graph edge endpoints must both be visible local bindings','PermissionDenied');
    ensure(GRAPH_RELATIONS.includes(raw.relation),'Unsupported canonical Project Graph relation');args.relation=raw.relation;
  }
  noSecrets(args);
  return{arguments:args,graph_binding:makeBinding(releaseId,action,rootName,project,resources)};
}

function graphPayload(result){
  let wire=result;
  if(wire&&typeof wire==='object'&&!Array.isArray(wire)&&wire.output&&typeof wire.output==='object')wire=wire.output;
  if(wire&&typeof wire==='object'&&!Array.isArray(wire)&&wire.result&&typeof wire.result==='object'&&('project' in wire||'graph_schema' in wire))return{wire,payload:wire.result};
  if(wire&&typeof wire==='object'&&!Array.isArray(wire)&&wire.result&&typeof wire.result==='object')return{wire,payload:wire.result};
  return{wire,payload:wire};
}
function graphSummary(result){
  const {wire,payload}=graphPayload(result);
  const coverage=payload&&typeof payload==='object'&&!Array.isArray(payload)?payload.coverage:null;
  let completeness='unknown';
  if(payload&&typeof payload==='object'&&!Array.isArray(payload)){
    if(payload.complete===true||coverage?.complete===true)completeness='complete';
    else if(payload.complete===false||payload.truncated===true||coverage?.complete===false)completeness='partial';
  }
  const snapshot=(payload&&typeof payload==='object'&&!Array.isArray(payload)?payload.snapshot:undefined)??(wire&&typeof wire==='object'&&!Array.isArray(wire)?wire.snapshot:undefined)??null;
  return{snapshot,completeness,unknown_frontier:completeness!=='complete'};
}
export function recordGraphObservation(app,input){
  inputObject(input,['work_id']);
  const work=app.get(input.work_id,'work');
  ensure(CANONICAL_GRAPH_ACTIONS.includes(work.data.action),'Work is not a canonical Project Graph operation','InvalidArgument');
  ensure(work.data.graph_binding,'Project Graph work is missing its exact application binding','Conflict');
  ensure(work.data.state==='RESPONSE_RECORDED','Project Graph response must be durably recorded before observation','Conflict');
  ensure(work.data.result&&typeof work.data.result==='object'&&!Array.isArray(work.data.result),'Project Graph response is missing','Conflict');
  const existing=app.list('graph_observation',work.data.release_id).find(o=>o.data.work_id===work.id);
  if(existing)return{entity:existing,reused:true};
  const drift=checkBinding(app,work.data.graph_binding);
  const admitted=app.capabilities.canonical_graph_admission===true&&drift.length===0;
  const summary=graphSummary(work.data.result);
  const resultDigest=digest('canonical-project-graph-response',{action:work.data.action,binding_sha256:work.data.graph_binding.binding_sha256,result:work.data.result});
  return{entity:app.store.create('graph_observation',{
    release_id:work.data.release_id,
    name:'Project Graph · '+work.data.action,
    work_id:work.id,
    work_version:work.version,
    action:work.data.action,
    root:work.data.graph_binding.root,
    project:work.data.graph_binding.project,
    binding_sha256:work.data.graph_binding.binding_sha256,
    resource_bindings:work.data.graph_binding.resources,
    result_sha256:resultDigest,
    graph_snapshot:summary.snapshot,
    completeness:summary.completeness,
    admission:admitted?'canonical-owner-admitted':'platform-response-not-admitted',
    authority:admitted?'PROJECT_GRAPH':'NONE',
    local_binding_state:drift.length?'STALE':'CURRENT',
    local_binding_drift:drift,
    recorded_by:app.principal,
    recorded_at:iso()
  }),reused:false};
}
export function inspectGraph(app,input){
  inputObject(input,['release_id']);app.get(input.release_id,'release');
  const observations=app.list('graph_observation',input.release_id).sort((a,b)=>a.created.localeCompare(b.created)).slice(-32).map(observation=>{
    let drift=observation.data.local_binding_drift??[];
    try{drift=app.freshness(observation.data.resource_bindings.map(r=>({id:r.resource_id,version:r.resource_version})));}catch{drift=[{reason:'binding-unreadable'}];}
    let work=null,workCurrent=false;
    try{work=app.get(observation.data.work_id,'work');workCurrent=work.version.generation===observation.data.work_version.generation&&work.version.revision===observation.data.work_version.revision;}catch{}
    const current=drift.length===0&&workCurrent;
    const canonical=observation.data.admission==='canonical-owner-admitted'&&current;
    return{
      id:observation.id,version:observation.version,action:observation.data.action,project:observation.data.project,
      graph_snapshot:observation.data.graph_snapshot,result_sha256:observation.data.result_sha256,
      completeness:observation.data.completeness,admission:observation.data.admission,
      effective_state:canonical?'CURRENT_OBSERVATION':observation.data.admission==='canonical-owner-admitted'?'STALE_LOCAL_BINDING':'NOT_ADMITTED',
      binding_drift:drift,resource_bindings:observation.data.resource_bindings,
      result:work?.data?.result??null
    };
  });
  const impacts=observations.filter(o=>o.action==='project.impact'&&o.effective_state==='CURRENT_OBSERVATION');
  const latest=impacts.at(-1)??null;
  const canonical=!!latest;
  const complete=latest?.completeness==='complete';
  return{
    schema_version:'launchwright-project-graph-status/1',release_id:input.release_id,observations,
    canonical_impacts:impacts,canonical_graph_authority:canonical,
    coverage:canonical?(complete?'CANONICAL_PROJECT_GRAPH_COMPLETE':'CANONICAL_PROJECT_GRAPH_OBSERVED'):'DECLARED_DEPENDENCIES_ONLY',
    unknown_frontier:!complete,
    authority_note:canonical?'Project Graph response was recorded in an owner-admitted session; Launchwright does not recompute Graph freshness.':'No current admitted Project Graph impact observation is bound to this release.'
  };
}
