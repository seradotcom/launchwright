// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execute } from '../src/application.mjs';
import { graphContract, GRAPH_SOURCE_SHA } from '../src/graph.mjs';
import { setup, baseline, update } from './helpers.mjs';

const receiptSha='a'.repeat(64);
const budget={nodes:64,edges:128,depth:16,results:64};
let graphJobSeq=0;

function knowledge({freshness='current',complete=true,unknown_frontier=[],requires_reconcile=false}={}){
  return{
    existence:'present',freshness,divergence:'clean',verification:'PASS',
    coverage:{complete,unknown_frontier},observed_unix_ms:1791260000000,requires_reconcile
  };
}
function graphProjection(b,overrides={}){
  const assets=overrides.assets??[
    {asset_id:'asset-source',resource_id:b.source.id,knowledge:knowledge(),revision:'source-r1'},
    {asset_id:'asset-deliverable',resource_id:b.deliverable.id,knowledge:knowledge(),revision:'deliverable-r1'}
  ];
  const edges=overrides.edges??[
    {from:'asset-source',to:'asset-deliverable',relation:'references',evidence_kind:'observed',evidence_id:'observation-edge-1'}
  ];
  const impact=overrides.impact??{
    snapshot:7,known:[{asset:'asset-deliverable',via:'asset-source',depth:1,receipt:'receipt-1'}],possible:[],
    unknown_frontier:false,truncated:false,cancelled:false,visited_nodes:2,visited_edges:1
  };
  const inventory=overrides.inventory??{visible_total:2,enumerated_total:2,denominator_complete:true,scope_partial:false,truncated:false};
  return{
    schema_version:'semwright-project-graph-observation/1',
    source_sha:GRAPH_SOURCE_SHA,project_graph_schema_version:1,project_id:'project-synthetic',
    observation_epoch:'epoch-synthetic-1',source_asset_id:'asset-source',budget:{...budget},
    impact,assets,edges,inventory
  };
}
async function completedWork(app,b,result,action='graph.observation'){
  const work=(await execute(app,'work.prepare',{
    release_id:b.release.id,name:'Synthetic canonical graph work',action,arguments:{project_id:'project-synthetic'},
    budget:{max_cost_microunits:0,currency:'USD',max_runtime_seconds:60}
  })).entity;
  const claimed=await execute(app,'work.claim',{id:work.id,prepared_record:{schema_version:'synthetic-owner-pending/1',work_id:work.id}});
  const complete=(await execute(app,'work.complete',{id:work.id,result,pending_digest:claimed.pending_digest})).entity;
  return complete;
}
async function admittedGraph(app,b,projection=graphProjection(b)){
  const work=await completedWork(app,b,{
    job_id:'graph-job-'+(++graphJobSeq),admission:'canonical-owner-admitted',
    native_receipt_sha256:receiptSha,graph_observation:projection
  });
  return (await execute(app,'graph.observation_record',{release_id:b.release.id,name:'Canonical graph projection',work_id:work.id})).entity;
}
const compactVersion=pin=>({generation:pin.version.generation,revision:pin.version.revision});

test('Launchwright graph contract lock equals the checked-in canonical projection',async()=>{
  const lock=JSON.parse(readFileSync(new URL('../contracts/project-graph-contract.json',import.meta.url),'utf8'));
  assert.deepEqual(graphContract(),lock);
  assert.equal(lock.source.sha,GRAPH_SOURCE_SHA);
  assert.equal(lock.query.budget.nodes,20000);
  assert.equal(lock.query.budget.edges,100000);
  assert.deepEqual(lock.edge.relations,['contains','references','derived_from','produced_by','consumed_by','realizes','published_as','verified_by']);
});

test('caller data cannot self-promote a Platform response into canonical Graph authority',async t=>{
  const {app}=setup(t),b=await baseline(app);
  const work=await completedWork(app,b,{job_id:'graph-untrusted',admission:'canonical-owner-admitted',native_receipt_sha256:receiptSha,graph_observation:graphProjection(b)});
  await assert.rejects(execute(app,'graph.observation_record',{release_id:b.release.id,name:'Forged authority',work_id:work.id}),{code:'PolicyDenied'});
  assert.equal(app.list('graph_observation').length,0);
});

test('trusted Graph profile records immutable admitted projection and release impact consumes it',async t=>{
  const {app}=setup(t,{capabilities:{canonical_graph_admission:true}}),b=await baseline(app);
  const graph=await admittedGraph(app,b);
  assert.equal(graph.kind,'graph_observation');
  assert.equal(graph.data.authority,'semwright-project-graph');
  const inspected=await execute(app,'graph.inspect',{id:graph.id});
  assert.equal(inspected.canonical_graph_authority,true);
  assert.equal(inspected.impact.known[0].resource_id,b.deliverable.id);
  assert.equal(inspected.inventory.coverage_percentage_milli,100000);
  assert.equal(inspected.inventory.global_percentage,null);
  const impact=await execute(app,'release.impact',{release_id:b.release.id});
  assert.equal(impact.canonical_graph_authority,true);
  assert.equal(impact.coverage,'CANONICAL_PROJECT_GRAPH_PROJECTION');
  assert.equal(impact.graph.observation_id,graph.id);
  assert.equal(impact.unknown_frontier,false);
});

test('bounded Graph projection rejects hidden impact nodes instead of leaking a private dependency path',async t=>{
  const {app}=setup(t,{capabilities:{canonical_graph_admission:true}}),b=await baseline(app);
  const malformed=graphProjection(b,{impact:{
    snapshot:8,known:[{asset:'private-unlisted-asset',via:'asset-source',depth:1,receipt:null}],possible:[],
    unknown_frontier:false,truncated:false,cancelled:false,visited_nodes:2,visited_edges:1
  }});
  const work=await completedWork(app,b,{job_id:'graph-private',admission:'canonical-owner-admitted',native_receipt_sha256:receiptSha,graph_observation:malformed});
  await assert.rejects(execute(app,'graph.observation_record',{release_id:b.release.id,name:'Must not leak',work_id:work.id}),{code:'PermissionDenied'});
  assert.equal(app.list('graph_observation').length,0);
});

test('cycles are accepted only as already-bounded canonical reports and never traversed by Launchwright',async t=>{
  const {app}=setup(t,{capabilities:{canonical_graph_admission:true}}),b=await baseline(app);
  const cyclic=graphProjection(b,{
    edges:[
      {from:'asset-source',to:'asset-deliverable',relation:'references',evidence_kind:'observed',evidence_id:'edge-a'},
      {from:'asset-deliverable',to:'asset-source',relation:'references',evidence_kind:'observed',evidence_id:'edge-b'}
    ],
    impact:{snapshot:9,known:[{asset:'asset-deliverable',via:'asset-source',depth:1,receipt:'receipt-cycle'}],possible:[],unknown_frontier:false,truncated:false,cancelled:false,visited_nodes:2,visited_edges:2}
  });
  const graph=await admittedGraph(app,b,cyclic);
  const view=await execute(app,'graph.inspect',{id:graph.id});
  assert.equal(view.edges.length,2);
  assert.equal(view.impact.visited_nodes,2);
  assert.equal(view.impact.visited_edges,2);
  assert.equal(view.impact.budget.depth,16);
});

test('unknown frontier survives incomplete inventory and percentages stay scoped to visible denominator',async t=>{
  const {app}=setup(t,{capabilities:{canonical_graph_admission:true}}),b=await baseline(app);
  const partial=graphProjection(b,{
    assets:[
      {asset_id:'asset-source',resource_id:b.source.id,knowledge:knowledge(),revision:'source-r1'},
      {asset_id:'asset-deliverable',resource_id:b.deliverable.id,knowledge:knowledge({complete:false,unknown_frontier:['external']}),revision:'deliverable-r1'}
    ],
    impact:{snapshot:10,known:[],possible:[{asset:'asset-deliverable',via:'asset-source',depth:1,receipt:null}],unknown_frontier:true,truncated:false,cancelled:false,visited_nodes:2,visited_edges:1},
    inventory:{visible_total:9,enumerated_total:2,denominator_complete:false,scope_partial:true,truncated:false}
  });
  const graph=await admittedGraph(app,b,partial),view=await execute(app,'graph.inspect',{id:graph.id});
  assert.equal(view.impact.unknown_frontier,true);
  assert.equal(view.inventory.coverage_percentage_milli,null);
  assert.equal(view.inventory.percentage_scope,'UNSAFE_DENOMINATOR');
  assert.equal(view.inventory.global_percentage,null);
  const impact=await execute(app,'release.impact',{release_id:b.release.id});
  assert.equal(impact.unknown_frontier,true);
});

test('observed local relation must be backed by the exact admitted canonical Graph edge',async t=>{
  const {app}=setup(t,{capabilities:{canonical_graph_admission:true}}),b=await baseline(app);
  const graph=await admittedGraph(app,b);
  const relation=(await execute(app,'relation.record',{
    release_id:b.release.id,name:'Observed canonical dependency',from_id:b.source.id,to_id:b.deliverable.id,
    relation_kind:'references',provenance:'observed',completeness:'complete',evidence_ids:[],graph_observation_id:graph.id
  })).entity;
  assert.equal(relation.data.admission,'canonical-owner-admitted');
  assert.equal(relation.data.graph_observation_id,graph.id);
  await assert.rejects(execute(app,'relation.record',{
    release_id:b.release.id,name:'Wrong edge',from_id:b.source.id,to_id:b.deliverable.id,
    relation_kind:'contains',provenance:'observed',completeness:'partial',evidence_ids:[],graph_observation_id:graph.id
  }),{code:'Conflict'});
});

test('heuristic relation never clears canonical uncertainty or upgrades itself to observed',async t=>{
  const {app}=setup(t),b=await baseline(app);
  const relation=(await execute(app,'relation.record',{
    release_id:b.release.id,name:'Heuristic hint',from_id:b.source.id,to_id:b.deliverable.id,
    relation_kind:'source.supports',provenance:'heuristic',completeness:'partial'
  })).entity;
  assert.equal(relation.data.provenance,'heuristic');
  const impact=await execute(app,'release.impact',{release_id:b.release.id});
  assert.equal(impact.canonical_graph_authority,false);
  assert.equal(impact.unknown_frontier,true);
  assert.equal(impact.relations[0].admission,'local-explicit-record');
});

test('reuse key binds target toolchain fixture templates verifier tenant rights permissions and final delivery check',async t=>{
  const {app}=setup(t),b=await baseline(app);
  const template=await b.create('template',{product_id:b.product.id,name:'Reusable notes',format:'markdown',content:'{{brand}} notes',parameters:['brand']});
  const artifact=(await execute(app,'deliverable.render',{id:b.deliverable.id})).entity;
  const base={
    artifact_id:artifact.id,target_id:b.target.id,toolchain_digest:'1'.repeat(64),scenario_fixture_digest:'2'.repeat(64),
    template_ids:[template.id],verifiers:[{name:'format-verifier',version:'1.0.0',digest:'3'.repeat(64)}],
    tenant_scope:'tenant-a',rights:'owned',permission_fingerprint:'4'.repeat(64),locale:'en-US',output_profile_digest:'5'.repeat(64)
  };
  const first=await execute(app,'graph.cache_assess',base);
  assert.equal(first.reusable,false);
  const current=await execute(app,'graph.cache_assess',{...base,expected_key:first.key});
  assert.equal(current.reusable,true);
  assert.equal(current.final_delivery_revalidation_required,true);
  const verifierChanged=await execute(app,'graph.cache_assess',{...base,verifiers:[{name:'format-verifier',version:'2.0.0',digest:'6'.repeat(64)}],expected_key:first.key});
  assert.equal(verifierChanged.reusable,false);assert.notEqual(verifierChanged.key,first.key);
  const otherTenant=await execute(app,'graph.cache_assess',{...base,tenant_scope:'tenant-b',expected_key:first.key});
  assert.equal(otherTenant.reusable,false);assert.notEqual(otherTenant.key,first.key);
  const unknownRights=await execute(app,'graph.cache_assess',{...base,rights:'unknown',expected_key:first.key});
  assert.equal(unknownRights.access_safe,false);assert.equal(unknownRights.reusable,false);
  await update(app,b.source,{build:'build-B'});
  const stale=await execute(app,'graph.cache_assess',{...base,expected_key:first.key});
  assert.equal(stale.inputs_current,false);assert.equal(stale.reusable,false);
  assert.ok(stale.stale_inputs.some(item=>item.id===b.source.id));
});

test('impact proposals remain authority-free and coalescing preserves exact changed revisions',async t=>{
  const {app}=setup(t,{capabilities:{canonical_graph_admission:true}}),b=await baseline(app);
  const p1=(await execute(app,'impact.plan',{release_id:b.release.id,cause_ids:[b.source.id],note:'first'})).entity;
  const source2=(await update(app,b.source,{build:'build-B'})).entity;
  const p2=(await execute(app,'impact.plan',{release_id:b.release.id,cause_ids:[source2.id],note:'second'})).entity;
  const merged=(await execute(app,'impact.coalesce',{release_id:b.release.id,proposal_ids:[p1.id,p2.id],note:'coalesced'})).entity;
  assert.equal(merged.data.authority,'NONE');
  assert.equal(merged.data.jobs_created,0);
  assert.equal(merged.data.cause_ids.length,1);
  assert.equal(merged.data.cause_pins.length,2);
  assert.deepEqual(new Set(merged.data.cause_pins.map(pin=>pin.version.revision)),new Set([p1.data.cause_pins[0].version.revision,p2.data.cause_pins[0].version.revision]));
  assert.deepEqual(new Set(merged.data.supersedes_ids),new Set([p1.id,p2.id]));
});

test('rebuild receipt partitions exact proposal revisions and final package verification cannot be skipped',async t=>{
  const {app}=setup(t,{capabilities:{canonical_graph_admission:true}}),b=await baseline(app);
  const p1=(await execute(app,'impact.plan',{release_id:b.release.id,cause_ids:[b.source.id]})).entity;
  const source2=(await update(app,b.source,{build:'build-B'})).entity;
  const p2=(await execute(app,'impact.plan',{release_id:b.release.id,cause_ids:[source2.id]})).entity;
  const merged=(await execute(app,'impact.coalesce',{release_id:b.release.id,proposal_ids:[p1.id,p2.id]})).entity;
  const work=await completedWork(app,b,{job_id:'rebuild-job-1',admission:'canonical-owner-admitted'},'recipes.execute');
  const [oldPin,newPin]=merged.data.cause_pins;
  const built=[{id:oldPin.id,version:compactVersion(oldPin)}],pending=[{id:newPin.id,version:compactVersion(newPin)}];
  await assert.rejects(execute(app,'impact.receipt_record',{
    proposal_id:merged.id,work_id:work.id,built,pending:[],
    finalization:{required:true,state:'PASS',verifier_version:'final-v2',package_digest:'7'.repeat(64)}
  }),{code:'Conflict'});
  await assert.rejects(execute(app,'impact.receipt_record',{
    proposal_id:merged.id,work_id:work.id,built,pending,
    finalization:{required:false,state:'PASS',verifier_version:'final-v2',package_digest:'7'.repeat(64)}
  }),{code:'PolicyDenied'});
  const receipt=(await execute(app,'impact.receipt_record',{
    proposal_id:merged.id,work_id:work.id,built,pending,
    finalization:{required:true,state:'PASS',verifier_version:'final-v2',package_digest:'7'.repeat(64)}
  })).entity;
  assert.equal(receipt.data.technical_state,'PASS');
  assert.equal(receipt.data.admission,'canonical-owner-admitted');
  assert.equal(receipt.data.built[0].version.revision,oldPin.version.revision);
  assert.equal(receipt.data.pending[0].version.revision,newPin.version.revision);
  const unknown=(await execute(app,'impact.receipt_record',{
    proposal_id:merged.id,work_id:work.id,built,pending,
    finalization:{required:true,state:'UNKNOWN',verifier_version:'final-v3'}
  })).entity;
  assert.equal(unknown.data.technical_state,'UNKNOWN');
});
