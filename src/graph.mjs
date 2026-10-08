// SPDX-License-Identifier: AGPL-3.0-only
import { requireCondition as ensure, object, integer, validateValue } from '@semwright/native-sdk';
import { inputObject, str, array, choice, sha, digest, iso, RIGHTS, noSecrets } from './contracts.mjs';

export const GRAPH_SOURCE_SHA='d2da9a495a53fe279a1ca4de61f0e24646350f22';
export const GRAPH_SCHEMA_VERSION=1;
export const GRAPH_RELATIONS=Object.freeze(['contains','references','derived_from','produced_by','consumed_by','realizes','published_as','verified_by']);
export const GRAPH_EDGE_EVIDENCE=Object.freeze(['declared','observed','executed']);
export const GRAPH_PRESENTATION_STATES=Object.freeze(['CURRENT','STALE','UNKNOWN','MISSING','DIVERGED']);
export const GRAPH_PROVENANCE=Object.freeze(['declared','observed','imported','heuristic']);
export const GRAPH_LIMITS=Object.freeze({nodes:20000,edges:100000,depth:256,results:10000});

export function graphContract(){
  return{
    schema_version:'launchwright-project-graph-contract/1',
    source:{repository:'seradotcom/semwright',sha:GRAPH_SOURCE_SHA,crate:'semwright-project-graph',schema_version:GRAPH_SCHEMA_VERSION},
    query:{budget:{...GRAPH_LIMITS},visibility:'authorized-project-view',cycles:'bounded-not-assumed-dag'},
    edge:{relations:[...GRAPH_RELATIONS],evidence:[...GRAPH_EDGE_EVIDENCE]},
    provenance:[...GRAPH_PROVENANCE],
    presentation_states:[...GRAPH_PRESENTATION_STATES],
    authority:'Semwright Project Graph / trusted Host admission; Launchwright stores projections only'
  };
}

function bool(value,label){ensure(typeof value==='boolean',label+' must be boolean');return value;}
function version(value){
  object(value,['generation','revision'],['generation','revision']);
  str(value.generation,128);str(value.revision,64);ensure(/^(0|[1-9][0-9]*)$/.test(value.revision),'Resource revision must be a canonical decimal string');
  return{generation:value.generation,revision:value.revision};
}
function graphBudget(raw){
  object(raw,['nodes','edges','depth','results'],['nodes','edges','depth','results']);
  return{
    nodes:integer(raw.nodes,1,GRAPH_LIMITS.nodes),
    edges:integer(raw.edges,1,GRAPH_LIMITS.edges),
    depth:integer(raw.depth,1,GRAPH_LIMITS.depth),
    results:integer(raw.results,1,GRAPH_LIMITS.results)
  };
}
function graphCoverage(raw){
  object(raw,['complete','unknown_frontier'],['complete','unknown_frontier']);
  bool(raw.complete,'coverage.complete');array(raw.unknown_frontier,32).forEach(v=>str(v,64));
  ensure(new Set(raw.unknown_frontier).size===raw.unknown_frontier.length,'Duplicate graph coverage frontier');
  ensure(!raw.complete||raw.unknown_frontier.length===0,'Complete graph coverage cannot have an unknown frontier');
  return{complete:raw.complete,unknown_frontier:[...raw.unknown_frontier]};
}
function knowledgeLabel(k){
  if(k.existence==='missing')return'MISSING';
  if(k.divergence==='diverged')return'DIVERGED';
  if(k.freshness==='stale')return'STALE';
  if(k.existence==='present'&&k.freshness==='current'&&!k.requires_reconcile)return'CURRENT';
  return'UNKNOWN';
}
function graphKnowledge(raw){
  object(raw,['existence','freshness','divergence','verification','coverage','observed_unix_ms','requires_reconcile','label'],['existence','freshness','divergence','verification','coverage','requires_reconcile']);
  choice(raw.existence,['present','missing','unknown']);
  choice(raw.freshness,['current','stale','unknown']);
  choice(raw.divergence,['clean','diverged','unknown']);
  choice(raw.verification,['PASS','FAIL','UNKNOWN']);
  const coverage=graphCoverage(raw.coverage);
  const observed=raw.observed_unix_ms===undefined||raw.observed_unix_ms===null?null:integer(raw.observed_unix_ms,1,Number.MAX_SAFE_INTEGER);
  bool(raw.requires_reconcile,'knowledge.requires_reconcile');
  const normalized={existence:raw.existence,freshness:raw.freshness,divergence:raw.divergence,verification:raw.verification,coverage,observed_unix_ms:observed,requires_reconcile:raw.requires_reconcile};
  const label=knowledgeLabel(normalized);
  if(raw.label!==undefined)ensure(raw.label===label,'Project Graph presentation label differs from canonical knowledge dimensions','Conflict');
  return{...normalized,label};
}
function graphHit(raw,assets,budget){
  object(raw,['asset','via','depth','receipt'],['asset','via','depth']);
  str(raw.asset,256);str(raw.via,256);integer(raw.depth,1,budget.depth);
  ensure(assets.has(raw.asset)&&assets.has(raw.via),'Graph impact hit references a node outside the authorized visible projection','PermissionDenied');
  if(raw.receipt!==undefined&&raw.receipt!==null)str(raw.receipt,256);
  return{asset:raw.asset,via:raw.via,depth:raw.depth,receipt:raw.receipt??null};
}
function graphEdge(raw,assets){
  object(raw,['from','to','relation','evidence_kind','evidence_id'],['from','to','relation','evidence_kind','evidence_id']);
  str(raw.from,256);str(raw.to,256);choice(raw.relation,GRAPH_RELATIONS);choice(raw.evidence_kind,GRAPH_EDGE_EVIDENCE);str(raw.evidence_id,256);
  ensure(assets.has(raw.from)&&assets.has(raw.to),'Graph edge references a node outside the authorized visible projection','PermissionDenied');
  return{from:raw.from,to:raw.to,relation:raw.relation,evidence_kind:raw.evidence_kind,evidence_id:raw.evidence_id};
}
function graphAsset(app,release,raw){
  object(raw,['asset_id','resource_id','knowledge','revision'],['asset_id','resource_id','knowledge']);
  str(raw.asset_id,256);str(raw.resource_id,96);
  const resource=app.get(raw.resource_id);
  ensure(app.productOf(resource)===release.data.product_id,'Graph projection crosses the release product boundary','PermissionDenied');
  let revision=null;
  if(raw.revision!==undefined&&raw.revision!==null){str(raw.revision,256);revision=raw.revision;}
  return{asset_id:raw.asset_id,resource_id:resource.id,resource_version:resource.version,knowledge:graphKnowledge(raw.knowledge),revision};
}
function normalizeGraphObservation(app,release,raw){
  validateValue(raw);noSecrets(raw);
  object(raw,['schema_version','source_sha','project_graph_schema_version','project_id','observation_epoch','source_asset_id','budget','impact','assets','edges','inventory'],['schema_version','source_sha','project_graph_schema_version','project_id','observation_epoch','source_asset_id','budget','impact','assets','edges','inventory']);
  ensure(raw.schema_version==='semwright-project-graph-observation/1','Unsupported Graph observation projection','ProtocolMismatch');
  ensure(raw.source_sha===GRAPH_SOURCE_SHA,'Graph result was produced against a different Semwright source lock','Conflict');
  ensure(raw.project_graph_schema_version===GRAPH_SCHEMA_VERSION,'Project Graph schema version differs','ProtocolMismatch');
  str(raw.project_id,256);str(raw.observation_epoch,256);str(raw.source_asset_id,256);
  const budget=graphBudget(raw.budget);
  array(raw.assets,1024);const assetsList=raw.assets.map(item=>graphAsset(app,release,item));
  const assets=new Map(assetsList.map(item=>[item.asset_id,item]));
  ensure(assets.size===assetsList.length,'Duplicate Project Graph asset in visible projection');
  ensure(assets.has(raw.source_asset_id),'Graph source asset is not present in the authorized visible projection','PermissionDenied');
  array(raw.edges,2048);const edges=raw.edges.map(item=>graphEdge(item,assets));
  object(raw.impact,['snapshot','known','possible','unknown_frontier','truncated','cancelled','visited_nodes','visited_edges'],['snapshot','known','possible','unknown_frontier','truncated','cancelled','visited_nodes','visited_edges']);
  const snapshot=integer(raw.impact.snapshot,0,Number.MAX_SAFE_INTEGER);
  bool(raw.impact.unknown_frontier,'impact.unknown_frontier');bool(raw.impact.truncated,'impact.truncated');bool(raw.impact.cancelled,'impact.cancelled');
  const visitedNodes=integer(raw.impact.visited_nodes,0,budget.nodes),visitedEdges=integer(raw.impact.visited_edges,0,budget.edges);
  array(raw.impact.known,budget.results);array(raw.impact.possible,budget.results);
  ensure(raw.impact.known.length+raw.impact.possible.length<=budget.results,'Graph impact result exceeds requested result budget','ResourceExhausted');
  const known=raw.impact.known.map(item=>graphHit(item,assets,budget));
  const possible=raw.impact.possible.map(item=>graphHit(item,assets,budget));
  const knownIds=new Set(known.map(item=>item.asset));ensure(knownIds.size===known.length,'Duplicate known graph impact hit');
  ensure(possible.every(item=>!knownIds.has(item.asset)),'Graph result reports the same asset as known and possible','Conflict');
  if(raw.impact.truncated||raw.impact.cancelled)ensure(raw.impact.unknown_frontier,'Truncated/cancelled graph traversal must preserve an unknown frontier','Conflict');
  object(raw.inventory,['visible_total','enumerated_total','denominator_complete','scope_partial','truncated'],['visible_total','enumerated_total','denominator_complete','scope_partial','truncated']);
  const visibleTotal=integer(raw.inventory.visible_total,0,GRAPH_LIMITS.nodes),enumeratedTotal=integer(raw.inventory.enumerated_total,0,GRAPH_LIMITS.nodes);
  bool(raw.inventory.denominator_complete,'inventory.denominator_complete');bool(raw.inventory.scope_partial,'inventory.scope_partial');bool(raw.inventory.truncated,'inventory.truncated');
  ensure(enumeratedTotal===assetsList.length,'Inventory enumeration does not match visible asset projection','Conflict');
  ensure(enumeratedTotal<=visibleTotal,'Graph inventory enumerates more assets than its visible denominator','Conflict');
  if(raw.inventory.denominator_complete)ensure(!raw.inventory.scope_partial&&!raw.inventory.truncated,'Complete denominator cannot be partial or truncated','Conflict');
  return{
    schema_version:raw.schema_version,source_sha:raw.source_sha,project_graph_schema_version:raw.project_graph_schema_version,
    project_id:raw.project_id,observation_epoch:raw.observation_epoch,source_asset_id:raw.source_asset_id,budget,
    impact:{snapshot,known,possible,unknown_frontier:raw.impact.unknown_frontier,truncated:raw.impact.truncated,cancelled:raw.impact.cancelled,visited_nodes:visitedNodes,visited_edges:visitedEdges},
    assets:assetsList,edges,
    inventory:{visible_total:visibleTotal,enumerated_total:enumeratedTotal,denominator_complete:raw.inventory.denominator_complete,scope_partial:raw.inventory.scope_partial,truncated:raw.inventory.truncated}
  };
}

export function recordGraphObservation(app,input){
  inputObject(input,['release_id','name','work_id'],['release_id','name','work_id']);
  ensure(app.capabilities?.canonical_graph_admission===true,'Only a trusted Host-admitted Project Graph result may be promoted','PolicyDenied');
  const release=app.get(input.release_id,'release'),work=app.get(input.work_id,'work');str(input.name,160);
  ensure(work.data.release_id===release.id&&work.data.action==='graph.observation','Graph work binding differs from release/operation','Conflict');
  ensure(work.data.state==='RESPONSE_RECORDED'&&work.data.platform_job_id,'Graph work has no durable Platform result locator','Conflict');
  const result=work.data.result;object(result,['job_id','admission','native_receipt_sha256','graph_observation'],['job_id','admission','native_receipt_sha256','graph_observation']);
  ensure(result.job_id===work.data.platform_job_id,'Graph result job binding differs from work record','Conflict');
  ensure(result.admission==='canonical-owner-admitted','Project Graph result was not admitted by the trusted owner Host','PolicyDenied');sha(result.native_receipt_sha256);
  const graph=normalizeGraphObservation(app,release,result.graph_observation),graphDigest=digest('project-graph-observation',graph);
  const duplicate=app.list('graph_observation',release.id).find(item=>item.data.graph_digest===graphDigest);
  if(duplicate)return{entity:duplicate,deduplicated:true};
  return{entity:app.store.create('graph_observation',{
    release_id:release.id,name:input.name,work_id:work.id,platform_job_id:work.data.platform_job_id,
    native_receipt_sha256:result.native_receipt_sha256,graph,graph_digest:graphDigest,
    admission:'canonical-owner-admitted',authority:'semwright-project-graph',created_at:iso()
  }),deduplicated:false};
}

export function inspectGraphObservation(app,input){
  inputObject(input,['id']);const entity=app.get(input.id,'graph_observation'),g=entity.data.graph;
  const denominatorSafe=g.inventory.denominator_complete&&!g.inventory.scope_partial&&!g.inventory.truncated;
  const coveragePercentage=denominatorSafe?(g.inventory.visible_total===0?100000:Math.floor(g.inventory.enumerated_total*100000/g.inventory.visible_total)):null;
  const unknownFrontier=g.impact.unknown_frontier||g.impact.truncated||g.impact.cancelled||g.assets.some(a=>!a.knowledge.coverage.complete||a.knowledge.label==='UNKNOWN');
  const resources=new Map(g.assets.map(a=>[a.asset_id,a.resource_id]));
  return{
    observation_id:entity.id,release_id:entity.data.release_id,project_id:g.project_id,snapshot:g.impact.snapshot,observation_epoch:g.observation_epoch,
    canonical_graph_authority:true,source_sha:g.source_sha,
    impact:{known:g.impact.known.map(h=>({...h,resource_id:resources.get(h.asset)})),possible:g.impact.possible.map(h=>({...h,resource_id:resources.get(h.asset)})),unknown_frontier:unknownFrontier,truncated:g.impact.truncated,cancelled:g.impact.cancelled,visited_nodes:g.impact.visited_nodes,visited_edges:g.impact.visited_edges,budget:g.budget},
    assets:g.assets.map(a=>({asset_id:a.asset_id,resource_id:a.resource_id,state:a.knowledge.label,knowledge:a.knowledge,revision:a.revision})),
    edges:g.edges.map(e=>({...e,from_resource_id:resources.get(e.from),to_resource_id:resources.get(e.to)})),
    inventory:{...g.inventory,coverage_percentage_milli:coveragePercentage,percentage_scope:denominatorSafe?'ENUMERATED_VISIBLE_AUTHORIZED_ONLY':'UNSAFE_DENOMINATOR',global_percentage:null},
    no_private_node_projection:true
  };
}

export function latestGraphObservation(app,releaseId){
  const items=app.list('graph_observation',releaseId);
  if(!items.length)return null;
  return items.sort((a,b)=>a.data.created_at.localeCompare(b.data.created_at)||a.id.localeCompare(b.id)).at(-1);
}

export function assertObservedGraphEdge(app,graphObservationId,from,to,relation){
  const observation=app.get(graphObservationId,'graph_observation');
  const graph=observation.data.graph;
  const byResource=new Map(graph.assets.map(a=>[a.resource_id,a.asset_id]));
  const fromAsset=byResource.get(from.id),toAsset=byResource.get(to.id);
  ensure(fromAsset&&toAsset,'Observed relation resources are not in the admitted visible Graph projection','Conflict');
  const edge=graph.edges.find(e=>e.from===fromAsset&&e.to===toAsset&&e.relation===relation&&['observed','executed'].includes(e.evidence_kind));
  ensure(edge,'Observed relation is not supported by the admitted Project Graph edge set','Conflict');
  return{observation,edge};
}

export function cacheIdentity(app,input){
  inputObject(input,['artifact_id','target_id','toolchain_digest','scenario_fixture_digest','template_ids','verifiers','tenant_scope','rights','permission_fingerprint','locale','output_profile_digest','expected_key'],['artifact_id','target_id','toolchain_digest','scenario_fixture_digest','tenant_scope','rights','permission_fingerprint','locale','output_profile_digest']);
  const artifact=app.get(input.artifact_id,'artifact'),target=app.get(input.target_id,'target');
  ensure(artifact.data.target_id===target.id,'Cache target differs from artifact target','Conflict');
  sha(input.toolchain_digest);sha(input.scenario_fixture_digest);sha(input.permission_fingerprint);sha(input.output_profile_digest);str(input.tenant_scope,160);choice(input.rights,RIGHTS);str(input.locale,40);
  const templates=[];for(const id of input.template_ids??[]){str(id,96);const e=app.get(id);ensure(['template','release_template'].includes(e.kind),'Cache template pin has unsupported resource kind');ensure(app.productOf(e)===app.productOf(target),'Cache template crosses product boundary','PermissionDenied');templates.push({id:e.id,kind:e.kind,version:e.version,digest:digest('graph-template',e.data)});}
  ensure(new Set(templates.map(t=>t.id)).size===templates.length,'Duplicate cache template');
  const verifiers=[];array(input.verifiers??[],64).forEach(v=>{object(v,['name','version','digest'],['name','version','digest']);str(v.name,128);str(v.version,128);sha(v.digest);verifiers.push({name:v.name,version:v.version,digest:v.digest});});
  verifiers.sort((a,b)=>(a.name+'\0'+a.version).localeCompare(b.name+'\0'+b.version));
  const identity={
    schema_version:'launchwright-graph-reuse-key/1',
    artifact:{id:artifact.id,sha256:artifact.data.sha256,producer:artifact.data.producer??null,inputs:artifact.data.inputs},
    target:{id:target.id,version:target.version,digest:digest('graph-target',target.data)},
    toolchain_digest:input.toolchain_digest,scenario_fixture_digest:input.scenario_fixture_digest,
    templates,verifiers,tenant_scope:input.tenant_scope,rights:input.rights,permission_fingerprint:input.permission_fingerprint,
    locale:input.locale,output_profile_digest:input.output_profile_digest
  };
  const key=digest('graph-reuse',identity),staleInputs=app.freshness(artifact.data.inputs),accessSafe=!['unknown','restricted'].includes(input.rights);
  if(input.expected_key!==undefined)sha(input.expected_key);
  const keyMatch=input.expected_key===undefined?null:input.expected_key===key;
  return{key,identity,inputs_current:staleInputs.length===0,stale_inputs:staleInputs,access_safe:accessSafe,key_match:keyMatch,reusable:keyMatch===true&&staleInputs.length===0&&accessSafe,final_delivery_revalidation_required:true,authority:'reuse-assessment-only'};
}

function pinKey(pin){return pin.id+'@'+pin.version.generation+':'+pin.version.revision;}
export function createImpactProposal(app,input){
  inputObject(input,['release_id','cause_ids','note','graph_observation_id','supersedes_ids'],['release_id','cause_ids']);
  const release=app.get(input.release_id,'release');array(input.cause_ids,64);ensure(input.cause_ids.length>0,'Impact proposal requires at least one cause');ensure(new Set(input.cause_ids).size===input.cause_ids.length,'Duplicate impact causes');
  const causePins=input.cause_ids.map(id=>{const cause=app.get(id);ensure(app.productOf(cause)===release.data.product_id,'Impact cause belongs to another product','PermissionDenied');return{id:cause.id,kind:cause.kind,version:cause.version};});
  if(input.note)str(input.note,8000);
  let graphObservationId=input.graph_observation_id??latestGraphObservation(app,release.id)?.id??null;
  if(graphObservationId){const g=app.get(graphObservationId,'graph_observation');ensure(g.data.release_id===release.id,'Impact Graph observation belongs to another release','Conflict');}
  const supersedes=[];for(const id of input.supersedes_ids??[]){const p=app.get(id,'impact_proposal');ensure(p.data.release_id===release.id,'Superseded proposal belongs to another release','Conflict');supersedes.push(p.id);}
  ensure(new Set(supersedes).size===supersedes.length,'Duplicate superseded impact proposal');
  return app.store.create('impact_proposal',{
    release_id:release.id,name:'Impact proposal · '+release.data.name,cause_ids:[...input.cause_ids].sort(),cause_pins:causePins.sort((a,b)=>pinKey(a).localeCompare(pinKey(b))),
    graph_observation_id:graphObservationId,supersedes_ids:supersedes,note:input.note??'',source_workspace_version:app.store.version(),
    impact:app.impact(release.id),state:'PROPOSED',authority:'NONE',jobs_created:0,created_at:iso()
  });
}

export function coalesceImpact(app,input){
  inputObject(input,['release_id','proposal_ids','note'],['release_id','proposal_ids']);
  const release=app.get(input.release_id,'release');array(input.proposal_ids,32);ensure(input.proposal_ids.length>=2,'Coalescing requires at least two immutable proposals');ensure(new Set(input.proposal_ids).size===input.proposal_ids.length,'Duplicate impact proposal');
  const proposals=input.proposal_ids.map(id=>{const p=app.get(id,'impact_proposal');ensure(p.data.release_id===release.id,'Impact proposal belongs to another release','Conflict');ensure(p.data.state==='PROPOSED','Only proposed impact records may be coalesced','Conflict');return p;});
  const pins=new Map();for(const p of proposals)for(const pin of p.data.cause_pins??p.data.cause_ids.map(id=>({id,kind:app.get(id).kind,version:app.get(id).version})))pins.set(pinKey(pin),pin);
  const graphIds=[...new Set(proposals.map(p=>p.data.graph_observation_id).filter(Boolean))];
  if(input.note)str(input.note,8000);
  return app.store.create('impact_proposal',{
    release_id:release.id,name:'Impact proposal · '+release.data.name+' · coalesced',cause_ids:[...new Set([...pins.values()].map(p=>p.id))].sort(),cause_pins:[...pins.values()].sort((a,b)=>pinKey(a).localeCompare(pinKey(b))),
    graph_observation_id:graphIds.length===1?graphIds[0]:null,supersedes_ids:proposals.map(p=>p.id).sort(),coalesced_graph_observations:graphIds.sort(),
    note:input.note??'',source_workspace_version:app.store.version(),impact:app.impact(release.id),state:'PROPOSED',authority:'NONE',jobs_created:0,created_at:iso()
  });
}

function normalizeReceiptPins(raw,allowed,label){
  array(raw,128);const out=raw.map(pin=>{object(pin,['id','version'],['id','version']);str(pin.id,96);const p={id:pin.id,version:version(pin.version)};ensure(allowed.has(pinKey(p)),label+' pin is not part of the immutable proposal','Conflict');return p;});
  ensure(new Set(out.map(pinKey)).size===out.length,'Duplicate '+label+' pin');return out;
}
export function recordRebuildReceipt(app,input){
  inputObject(input,['proposal_id','work_id','built','pending','finalization'],['proposal_id','work_id','built','pending','finalization']);
  const proposal=app.get(input.proposal_id,'impact_proposal'),work=app.get(input.work_id,'work');
  ensure(work.data.release_id===proposal.data.release_id&&work.data.action==='recipes.execute','Rebuild work is not bound to this impact proposal','Conflict');
  ensure(work.data.state==='RESPONSE_RECORDED'&&work.data.platform_job_id,'Rebuild work has no durable Platform completion locator','Conflict');
  const proposalPins=proposal.data.cause_pins??proposal.data.cause_ids.map(id=>({id,version:app.get(id).version}));
  const allowed=new Set(proposalPins.map(pinKey)),built=normalizeReceiptPins(input.built,allowed,'built'),pending=normalizeReceiptPins(input.pending,allowed,'pending');
  const partition=new Set([...built,...pending].map(pinKey));ensure(partition.size===allowed.size&&[...allowed].every(k=>partition.has(k)),'Rebuild receipt must preserve every proposal cause as built or pending','Conflict');
  ensure(!built.some(b=>pending.some(p=>pinKey(p)===pinKey(b))),'A cause revision cannot be both built and pending','Conflict');
  object(input.finalization,['required','state','verifier_version','package_digest'],['required','state','verifier_version']);ensure(input.finalization.required===true,'Every new final delivery requires a finalization check','PolicyDenied');choice(input.finalization.state,['PASS','FAIL','UNKNOWN']);str(input.finalization.verifier_version,128);if(input.finalization.package_digest!==undefined)sha(input.finalization.package_digest);
  const admitted=app.capabilities?.canonical_graph_admission===true&&work.data.result?.admission==='canonical-owner-admitted';
  return app.store.create('rebuild_receipt',{
    release_id:proposal.data.release_id,name:'Rebuild receipt · '+proposal.data.name,proposal_id:proposal.id,work_id:work.id,platform_job_id:work.data.platform_job_id,
    built,pending,finalization:{...input.finalization,package_digest:input.finalization.package_digest??null},
    technical_state:admitted&&input.finalization.state==='PASS'?'PASS':input.finalization.state==='FAIL'?'FAIL':'UNKNOWN',
    admission:admitted?'canonical-owner-admitted':'recorded-not-admitted',authority:'RECEIPT_ONLY',created_at:iso()
  });
}
