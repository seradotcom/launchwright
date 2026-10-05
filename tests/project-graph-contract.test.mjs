// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { execute } from '../src/application.mjs';
import { setup, baseline, update } from './helpers.mjs';

async function graphWork(app,b,overrides={}){
  return (await execute(app,'work.prepare',{
    release_id:b.release.id,name:'Canonical Project Graph impact',action:'project.impact',
    arguments:{root:'owned_fixture',project:'project-synthetic',asset:'asset-source',budget:{nodes:32,edges:64,depth:8,results:16},bindings:[{resource_id:b.source.id,asset:'asset-source'}]},
    budget:{max_cost_microunits:0,currency:'USD',max_runtime_seconds:30},...overrides
  })).entity;
}
async function complete(app,work,result){
  const claimed=await execute(app,'work.claim',{id:work.id,prepared_record:{schema_version:'synthetic-platform-pending/1',action:work.data.action,arguments:work.data.arguments}});
  return (await execute(app,'work.complete',{id:work.id,pending_digest:claimed.pending_digest,result})).entity;
}

test('RS-GRF-01 canonical project.impact preparation strips app-only bindings and pins local revisions',async t=>{
  const{app}=setup(t),b=await baseline(app),work=await graphWork(app,b);
  assert.deepEqual(work.data.arguments,{root:'owned_fixture',project:'project-synthetic',asset:'asset-source',budget:{nodes:32,edges:64,depth:8,results:16}});
  assert.equal(work.data.graph_binding.action,'project.impact');
  assert.equal(work.data.graph_binding.resources[0].resource_id,b.source.id);
  assert.deepEqual(work.data.graph_binding.resources[0].resource_version,b.source.version);
  assert.match(work.data.graph_binding.binding_sha256,/^[a-f0-9]{64}$/);
});

test('RS-GRF-03 traversal and visibility bounds fail closed before Platform work is created',async t=>{
  const{app}=setup(t),b=await baseline(app);
  const base={release_id:b.release.id,name:'Bad graph',action:'project.impact',budget:{max_cost_microunits:0,currency:'USD',max_runtime_seconds:30}};
  await assert.rejects(execute(app,'work.prepare',{...base,arguments:{root:'../../private',project:'p',asset:'asset-source',bindings:[{resource_id:b.source.id,asset:'asset-source'}]}}),{code:'InvalidArgument'});
  await assert.rejects(execute(app,'work.prepare',{...base,arguments:{root:'owned_fixture',project:'p',asset:'hidden',bindings:[{resource_id:b.source.id,asset:'asset-source'}]}}),{code:'PermissionDenied'});
  await assert.rejects(execute(app,'work.prepare',{...base,arguments:{root:'owned_fixture',project:'p',asset:'asset-source',budget:{nodes:1001,edges:64,depth:8,results:16},bindings:[{resource_id:b.source.id,asset:'asset-source'}]}}),{code:'InvalidArgument'});
  assert.equal(app.list('work').length,0);
});

test('RS-GRF-02 edge declaration uses canonical relation vocabulary and explicit mutation consent',async t=>{
  const{app}=setup(t),b=await baseline(app);
  const deliverable=b.deliverable;
  const arguments_={root:'owned_fixture',project:'project-synthetic',from:'asset-source',to:'asset-doc',relation:'references',bindings:[{resource_id:b.source.id,asset:'asset-source'},{resource_id:deliverable.id,asset:'asset-doc'}]};
  const input={release_id:b.release.id,name:'Declare graph edge',action:'project.edge.declare',arguments:arguments_,budget:{max_cost_microunits:0,currency:'USD',max_runtime_seconds:30}};
  await assert.rejects(execute(app,'work.prepare',input),{code:'ConsentRequired'});
  const work=(await execute(app,'work.prepare',{...input,authorization:'explicit-graph-mutation'})).entity;
  assert.equal(work.data.arguments.relation,'references');
  assert.equal(work.data.graph_binding.resources.length,2);
  await assert.rejects(execute(app,'work.prepare',{...input,authorization:'explicit-graph-mutation',arguments:{...arguments_,relation:'supports'}}),{code:'InvalidArgument'});
});

test('RS-GRF-07 non-admitted Platform JSON never becomes canonical freshness',async t=>{
  const{app}=setup(t),b=await baseline(app),work=await graphWork(app,b);
  await complete(app,work,{project:'project-synthetic',graph_schema:1,result:{snapshot:7,complete:true,items:[]}});
  const observation=(await execute(app,'graph.record',{work_id:work.id})).entity;
  assert.equal(observation.data.admission,'platform-response-not-admitted');
  const graph=await execute(app,'graph.inspect',{release_id:b.release.id});
  assert.equal(graph.canonical_graph_authority,false);
  assert.equal(graph.unknown_frontier,true);
  assert.equal(app.impact(b.release.id).coverage,'DECLARED_DEPENDENCIES_ONLY');
});

test('RS-GRF-01 admitted Graph response is current only while its exact local binding remains current',async t=>{
  const{app}=setup(t),b=await baseline(app);app.capabilities.canonical_graph_admission=true;
  const work=await graphWork(app,b);
  await complete(app,work,{project:'project-synthetic',graph_schema:1,result:{snapshot:8,complete:true,items:[{asset:'asset-doc',path:['asset-source','asset-doc']}]}});
  const observation=(await execute(app,'graph.record',{work_id:work.id})).entity;
  assert.equal(observation.data.admission,'canonical-owner-admitted');
  let graph=await execute(app,'graph.inspect',{release_id:b.release.id});
  assert.equal(graph.canonical_graph_authority,true);
  assert.equal(graph.coverage,'CANONICAL_PROJECT_GRAPH_COMPLETE');
  assert.equal(app.impact(b.release.id).canonical_graph_authority,true);
  await update(app,b.source,{build:'build-B'});
  graph=await execute(app,'graph.inspect',{release_id:b.release.id});
  assert.equal(graph.canonical_graph_authority,false);
  assert.equal(graph.observations[0].effective_state,'STALE_LOCAL_BINDING');
  assert.equal(app.impact(b.release.id).unknown_frontier,true);
});

test('RS-GRF-02 observed local relation requires exact admitted Graph observation evidence',async t=>{
  const{app}=setup(t),b=await baseline(app);app.capabilities.canonical_graph_admission=true;
  const work=await graphWork(app,b);
  await complete(app,work,{project:'project-synthetic',graph_schema:1,result:{snapshot:9,complete:false,items:[]}});
  const observation=(await execute(app,'graph.record',{work_id:work.id})).entity;
  const relation=(await execute(app,'relation.record',{release_id:b.release.id,name:'Observed dependency',from_id:b.source.id,to_id:b.deliverable.id,relation_kind:'source.references',provenance:'observed',completeness:'partial',graph_observation_id:observation.id})).entity;
  assert.equal(relation.data.admission,'canonical-owner-admitted');
  assert.equal(relation.data.graph_observation_id,observation.id);
});

test('RS-GRF-04 and RS-GRF-08 coalescing creates a new authority-free proposal and preserves every cause',async t=>{
  const{app}=setup(t),b=await baseline(app);
  const first=(await execute(app,'impact.plan',{release_id:b.release.id,cause_ids:[b.source.id]})).entity;
  const second=(await execute(app,'impact.plan',{release_id:b.release.id,cause_ids:[b.target.id],coalesce_with:[first.id]})).entity;
  assert.deepEqual(second.data.cause_ids,[b.source.id,b.target.id].sort());
  assert.deepEqual(second.data.coalesced_from,[first.id]);
  assert.equal(second.data.authority,'NONE');assert.equal(second.data.jobs_created,0);
  assert.equal(app.list('work').length,0);
});
