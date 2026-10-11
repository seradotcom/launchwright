// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {existsSync,writeFileSync,unlinkSync} from 'node:fs';
import {setup} from './helpers.mjs';
import {makeBatchFixture} from './carry-forward-batch-fixture.mjs';
import {createAppServer} from '../src/server.mjs';
import {LaunchwrightClient} from '../client/index.mjs';
import {LaunchwrightApplication,execute} from '../src/application.mjs';
import {
  prepareCarryForwardBatch,inspectCarryForwardBatch,applyCarryForwardBatch
} from '../src/release-carry-forward-batch.mjs';

const OWNER='r71-owned-local-token-current-release';
const CONSUMER='r71-external-consumer-bearer-token';
const confirmation=p=>({
  confirm_plan_sha256:p.plan_sha256,
  confirm_source_candidate_sha256:p.source_candidate_sha256,
  confirm_destination_build:p.destination_build,
  acknowledge_create_all_drafts:true
});
async function fixture(t){
  const {app,root}=setup(t),f=await makeBatchFixture(app);
  const service=createAppServer(app,{port:0,token:OWNER,bearerPrincipals:[
    {principal:'consumer71',token:CONSUMER,scopes:['consume']}
  ]});
  const origin=await service.listen();t.after(()=>service.close());
  return{...f,app,root,origin,service,
    client:new LaunchwrightClient({baseUrl:origin,token:OWNER})};
}
function post(f,route,body,token=OWNER,moreHeaders={}){
  return fetch(f.origin+'/api/v1/release-carry-forward-batch/'+route,{
    method:'POST',
    headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',
      ...moreHeaders},
    body:JSON.stringify(body)
  });
}

test('R71 exact deterministic multi-item plan is order independent and reads only frozen Native identities',async t=>{
  const x=await fixture(t),before=x.app.store.all().length;
  const one=await x.client.planCarryForwardBatch(x.input);
  const twice=await x.client.planCarryForwardBatch({
    ...x.input,items:[...x.input.items].reverse()
  });
  assert.deepEqual(one,twice);
  assert.equal(one.document_count,2);
  assert.equal(one.source_candidate_sha256,x.candidate.data.candidate_sha256);
  assert.equal(one.destination_release_id,x.release.id);
  assert.equal(one.technical_state,'UNKNOWN');
  assert.equal(one.claims_inherited,false);
  assert.equal(one.evidence_inherited,false);
  assert.equal(one.artifacts_reused,false);
  assert.equal(one.platform_authority,false);
  assert.deepEqual(one.plans.map(p=>p.source_artifact_id),
    [...one.plans.map(p=>p.source_artifact_id)].sort());
  assert.ok(!JSON.stringify(one).includes(x.second.data.content));
  assert.equal(x.app.store.all().length,before);
  const inspected=await x.client.inspectCarryForwardBatch(one);
  assert.equal(inspected.state,'NOT_APPLIED');
  assert.equal(inspected.untouched_documents,2);
  assert.equal(inspected.completed_documents,0);
});

test('R71 two selected documents create independent Native drafts and provenance, zero inherited authorities',async t=>{
  const x=await fixture(t);
  const oldRows=x.app.list('deliverable',x.old.release.id).map(d=>
    structuredClone(d));
  const plan=await x.client.planCarryForwardBatch(x.input);
  const saved=await x.client.applyCarryForwardBatch(plan,confirmation(plan));
  assert.equal(saved.state,'BATCH_READY');
  assert.equal(saved.created_documents,2);
  assert.equal(saved.created_provenance_relations,2);
  assert.equal(saved.recovered,false);
  assert.equal(saved.total_documents,2);
  const drafts=x.app.list('deliverable',x.release.id);
  const edges=x.app.list('relation',x.release.id);
  assert.equal(drafts.length,2);
  assert.equal(edges.length,2);
  for(const d of drafts){
    assert.deepEqual(d.data.claim_ids,[]);
    assert.deepEqual(d.data.copy_block_ids,[]);
    assert.deepEqual(d.data.source_ids,[]);
    assert.match(d.data.content,/REVERIFY FOR THIS BUILD BEFORE USE/);
  }
  for(const edge of edges){
    assert.equal(edge.data.provenance,'declared');
    assert.equal(edge.data.completeness,'unknown');
    assert.equal(edge.data.relation_kind,'editorial_carry_forward');
    assert.ok(drafts.some(d=>d.id===edge.data.to_id));
  }
  assert.equal(x.app.list('artifact',x.release.id).length,0);
  assert.equal(x.app.list('candidate',x.release.id).length,0);
  assert.equal(x.app.list('review',x.release.id).length,0);
  assert.equal(x.app.list('verification',x.release.id).length,0);
  assert.equal(x.app.list('evidence',x.release.id).length,0);
  assert.deepEqual(x.app.list('deliverable',x.old.release.id),oldRows);
  const again=await x.client.applyCarryForwardBatch(plan,confirmation(plan));
  assert.equal(again.recovered,true);
  assert.equal(again.created_documents,0);
  assert.equal(again.created_provenance_relations,0);
  assert.equal(x.app.list('deliverable',x.release.id).length,2);
  assert.equal(x.app.list('relation',x.release.id).length,2);
});

test('R71 HTTP rejects nonowner, cross-origin, unexpected fields, bad consent and wrong full confirmation',async t=>{
  const x=await fixture(t);
  for(const route of ['plan','apply','inspect']){
    assert.equal((await post(x,route,{},CONSUMER)).status,403);
    assert.equal((await post(x,route,{},'bad-credential')).status,403);
    assert.equal((await post(x,route,{},OWNER,{
      Origin:'https://unauthorized.example.invalid'
    })).status,403);
  }
  assert.equal((await post(x,'plan',{
    ...x.input,shell_command:'echo unsafe'
  })).status,400);
  assert.equal((await post(x,'plan',{
    ...x.input,acknowledge_historical_rights:false
  })).status,403);
  const plan=await x.client.planCarryForwardBatch(x.input);
  for(const patch of [
    {confirm_plan_sha256:'a'.repeat(64)},
    {confirm_source_candidate_sha256:'b'.repeat(64)},
    {confirm_destination_build:'unknown build'},
    {acknowledge_create_all_drafts:false}
  ]){
    assert.equal((await post(x,'apply',{
      plan,...confirmation(plan),...patch
    })).status,403);
  }
  assert.equal((await post(x,'apply',{
    plan,...confirmation(plan),publish_to:'github'
  })).status,400);
  assert.equal(x.app.list('deliverable',x.release.id).length,0);
});

test('R71 duplicate titles, sources, too few and too many items fail BEFORE any writes',async t=>{
  const x=await fixture(t);
  assert.throws(()=>prepareCarryForwardBatch(x.app,{
    ...x.input,items:[x.selections[0]]
  }),{code:'InvalidArgument'});
  assert.throws(()=>prepareCarryForwardBatch(x.app,{
    ...x.input,items:[...x.selections,x.selections[0]]
  }),{code:'Conflict'});
  assert.throws(()=>prepareCarryForwardBatch(x.app,{
    ...x.input,items:[
      x.selections[0],{...x.selections[1],
        destination_name:x.selections[0].destination_name.toUpperCase()}
    ]
  }),{code:'Conflict'});
  assert.throws(()=>prepareCarryForwardBatch(x.app,{
    ...x.input,items:Array(9).fill(x.selections[0])
  }));
  assert.equal(x.app.list('deliverable',x.release.id).length,0);
});

test('R71 wrong source Candidate or destination product fails without accepting mixed sources',async t=>{
  const x=await fixture(t);
  assert.throws(()=>prepareCarryForwardBatch(x.app,{
    ...x.input,source_candidate_id:x.candidate.id,
    items:[{...x.selections[0],source_artifact_id:'artifact_not_exist'},x.selections[1]]
  }));
  const foreign=(await execute(x.app,'entity.create',{kind:'product',
    data:{name:'Unrelated product'}})).entity;
  const foreignRelease=(await execute(x.app,'entity.create',{kind:'release',
    data:{product_id:foreign.id,name:'Foreign release',build:'foreign',status:'draft'}})).entity;
  assert.throws(()=>prepareCarryForwardBatch(x.app,{
    ...x.input,destination_release_id:foreignRelease.id
  }));
  assert.equal(x.app.list('deliverable',x.release.id).length,0);
});

test('R71 batch preflight rejects a human-edited matching draft BEFORE any other item is created',async t=>{
  const x=await fixture(t);
  const batch=await x.client.planCarryForwardBatch(x.input);
  const selected=batch.plans[1];
  const first=(await execute(x.app,'entity.create',{kind:'deliverable',
    data:{
      release_id:selected.destination_release_id,
      target_id:selected.destination_target_id,
      name:selected.created_name,format:'markdown',
      content:'Human created an unrelated same-name document',
      claim_ids:[],copy_block_ids:[],source_ids:[]
    }})).entity;
  assert.ok(first.id);
  const res=await post(x,'apply',{plan:batch,...confirmation(batch)});
  assert.equal(res.status,409);
  assert.equal(x.app.list('deliverable',x.release.id).length,1);
  assert.equal(x.app.list('relation',x.release.id).length,0);
});

test('R71 interrupted second relation produces durable partial status and exact-plan resume',async t=>{
  const x=await fixture(t),p=await x.client.planCarryForwardBatch(x.input);
  const original=x.app.store.create.bind(x.app.store);
  let writes=0;
  x.app.store.create=(kind,...args)=>{
    if(kind==='relation'&&++writes===2)
      throw Error('Synthetic host interrupt before second provenance commit');
    return original(kind,...args);
  };
  const result=await post(x,'apply',{plan:p,...confirmation(p)});
  assert.equal(result.status,500);
  const status=await x.client.inspectCarryForwardBatch(p);
  assert.equal(status.state,'PARTIAL_NEEDS_RECONCILIATION');
  assert.equal(status.completed_documents,1);
  assert.equal(status.incomplete_documents,1);
  assert.equal(status.untouched_documents,0);
  assert.equal(status.requires_manual_reconciliation,true);
  assert.equal(x.app.list('deliverable',x.release.id).length,2);
  assert.equal(x.app.list('relation',x.release.id).length,1);
  // A deliberate same-plan replay repairs exactly the missing relation.
  const resumed=await x.client.applyCarryForwardBatch(p,confirmation(p));
  assert.equal(resumed.state,'BATCH_READY');
  assert.equal(resumed.created_documents,0);
  assert.equal(resumed.created_provenance_relations,1);
  assert.equal(resumed.recovered,false);
  assert.equal(x.app.list('deliverable',x.release.id).length,2);
  assert.equal(x.app.list('relation',x.release.id).length,2);
});

test('R71 lost HTTP reply is reconciled by INSPECT, never by automatic duplicate POST',async t=>{
  const x=await fixture(t),p=await x.client.planCarryForwardBatch(x.input);
  let sends=0;
  const client=new LaunchwrightClient({baseUrl:x.origin,token:OWNER,
    fetchImpl:async(url,options)=>{
      const response=await fetch(url,options);
      if(url.endsWith('/release-carry-forward-batch/apply')){
        sends++;throw Error('Synthetic transport reply lost');
      }
      return response;
    }
  });
  await assert.rejects(client.applyCarryForwardBatch(p,confirmation(p)),{
    code:'Unavailable'
  });
  assert.equal(sends,1);
  const recovered=await x.client.inspectCarryForwardBatch(p);
  assert.equal(recovered.state,'BATCH_READY');
  assert.equal(sends,1);
  assert.equal(x.app.list('deliverable',x.release.id).length,2);
  assert.equal(x.app.list('relation',x.release.id).length,2);
  const replay=await x.client.applyCarryForwardBatch(p,confirmation(p));
  assert.equal(replay.recovered,true);
  assert.equal(replay.created_documents,0);
});

test('R71 shared R70/R71 writer lock prevents concurrent single and batch operation',async t=>{
  const x=await fixture(t),p=await x.client.planCarryForwardBatch(x.input);
  const lock=join(x.root,'.release-carry-forward.lock');
  writeFileSync(lock,'Owner must reconcile an unknown previous attempt',
    {mode:0o600});
  assert.equal((await post(x,'apply',{plan:p,...confirmation(p)})).status,409);
  assert.equal(existsSync(lock),true);
  unlinkSync(lock);
  const s=await x.client.inspectCarryForwardBatch(p);
  assert.equal(s.state,'NOT_APPLIED');
});

test('R71 changed source revision or new historical review invalidates ENTIRE batch',async t=>{
  const x=await fixture(t),p=await x.client.planCarryForwardBatch(x.input);
  await execute(x.app,'candidate.review',{
    id:x.candidate.id,candidate_sha256:x.candidate.data.candidate_sha256,
    decision:'approve-editorial',comment:'New reviewer updated historical state'
  });
  assert.equal((await post(x,'apply',{plan:p,...confirmation(p)})).status,409);
  assert.equal(x.app.list('deliverable',x.release.id).length,0);
});

test('R71 status is durable across app instances and retains source identity',async t=>{
  const x=await fixture(t),p=await x.client.planCarryForwardBatch(x.input);
  await x.client.applyCarryForwardBatch(p,confirmation(p));
  const second=new LaunchwrightApplication(x.root);
  t.after(()=>second.close());
  const observed=inspectCarryForwardBatch(second,p);
  assert.equal(observed.state,'BATCH_READY');
  assert.equal(observed.plan_sha256,p.plan_sha256);
  assert.equal(observed.rows.length,2);
  assert.equal(observed.claims_inherited,false);
  assert.equal(observed.external_send_performed,false);
});
