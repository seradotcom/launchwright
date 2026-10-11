// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {existsSync,writeFileSync,unlinkSync} from 'node:fs';
import {setup} from './helpers.mjs';
import {makeCarryForwardFixture} from './carry-forward-fixture.mjs';
import {createAppServer} from '../src/server.mjs';
import {LaunchwrightClient} from '../client/index.mjs';
import {prepareCarryForward,inspectCarryForward,
  applyCarryForward} from '../src/release-carry-forward.mjs';
import {execute} from '../src/application.mjs';

const OWNER='owned-r70-local-session-token-2026';
const CONSUMER='synthetic-r70-consumer-bearer-token';
const confirmation=p=>({
  confirm_plan_sha256:p.plan_sha256,
  confirm_source_candidate_sha256:p.source_candidate_sha256,
  confirm_destination_build:p.destination_build,
  acknowledge_create_draft:true
});
async function fixture(t){
  const{app,root}=setup(t),f=await makeCarryForwardFixture(app);
  const srv=createAppServer(app,{port:0,token:OWNER,bearerPrincipals:[
    {principal:'outside-consumer',token:CONSUMER,scopes:['consume']}
  ]});
  const origin=await srv.listen();t.after(()=>srv.close());
  return{app,root,...f,srv,origin,
    client:new LaunchwrightClient({baseUrl:origin,token:OWNER})};
}
function post(f,route,payload,token=OWNER,moreHeaders={}){
  return fetch(f.origin+'/api/v1/release-carry-forward/'+route,{
    method:'POST',headers:{
      Authorization:'Bearer '+token,'Content-Type':'application/json',
      ...moreHeaders
    },body:JSON.stringify(payload)
  });
}
test('R70 plan is deterministic, source-bound and read-only, with no source copy exposed',async t=>{
  const x=await fixture(t),before=x.app.store.all().length;
  const first=await x.client.planCarryForward(x.input);
  const second=await x.client.planCarryForward(x.input);
  assert.deepEqual(first,second);
  assert.equal(first.source_candidate_sha256,x.candidate.data.candidate_sha256);
  assert.equal(first.source_artifact_sha256,x.artifact.data.sha256);
  assert.equal(first.destination_release_id,x.release.id);
  assert.equal(first.destination_build,x.release.data.build);
  assert.match(first.plan_sha256,/^[a-f0-9]{64}$/u);
  assert.match(first.created_name,/ · review [a-f0-9]{12}$/u);
  assert.equal(first.imported_references,0);
  assert.equal(first.technical_state,'UNKNOWN');
  assert.equal(first.claims_inherited,false);
  assert.equal(first.evidence_inherited,false);
  assert.equal(first.platform_authority,false);
  assert.ok(!JSON.stringify(first).includes(x.old.deliverable.data.content));
  assert.equal(x.app.store.all().length,before);
  assert.equal(inspectCarryForward(x.app,first).state,'NOT_APPLIED');
});

test('R70 actual Native draft and provenance do not inherit claims, artifact, source, approvals or evidence',async t=>{
  const x=await fixture(t);
  const oldSnapshot=structuredClone(x.app.get(x.old.deliverable.id));
  const plan=await x.client.planCarryForward(x.input);
  const result=await x.client.applyCarryForward(plan,confirmation(plan));
  assert.equal(result.state,'DRAFT_READY');
  assert.equal(result.created_deliverable,true);
  assert.equal(result.created_relation,true);
  assert.equal(result.recovered,false);
  assert.equal(result.technical_state,'UNKNOWN');
  const next=x.app.get(result.deliverable_id,'deliverable');
  assert.equal(next.data.release_id,x.release.id);
  assert.equal(next.data.target_id,x.target.id);
  assert.equal(next.data.format,'markdown');
  assert.equal(next.data.name,plan.created_name);
  assert.deepEqual(next.data.claim_ids,[]);
  assert.deepEqual(next.data.source_ids,[]);
  assert.deepEqual(next.data.copy_block_ids,[]);
  assert.match(next.data.content,/REVERIFY FOR THIS BUILD BEFORE USE/);
  assert.match(next.data.content,/No technical claims, availability, rights/);
  assert.ok(next.data.content.endsWith(x.old.deliverable.data.content));
  assert.equal(x.app.list('artifact',x.release.id).length,0);
  assert.equal(x.app.list('candidate',x.release.id).length,0);
  assert.equal(x.app.list('verification',x.release.id).length,0);
  assert.equal(x.app.list('review',x.release.id).length,0);
  const relation=x.app.get(result.relation_id,'relation');
  assert.equal(relation.data.from_id,x.old.deliverable.id);
  assert.equal(relation.data.to_id,next.id);
  assert.equal(relation.data.provenance,'declared');
  assert.equal(relation.data.completeness,'unknown');
  assert.equal(relation.data.admission,'local-explicit-record');
  assert.equal(relation.data.graph_observation_id,null);
  assert.deepEqual(x.app.get(x.old.deliverable.id),oldSnapshot);
  assert.equal((await x.client.inspectCarryForward(plan)).state,'DRAFT_READY');
  const again=await x.client.applyCarryForward(plan,confirmation(plan));
  assert.equal(again.recovered,true);
  assert.equal(again.created_deliverable,false);
  assert.equal(again.created_relation,false);
  assert.equal(again.deliverable_id,next.id);
  assert.equal(x.app.list('relation',x.release.id).length,1);
});

test('R70 authentication, cross-origin, source rights, body limits and confirmations fail closed',async t=>{
  const x=await fixture(t);
  for(const op of ['plan','apply','inspect']){
    for(const token of ['WRONG',CONSUMER])
      assert.equal((await post(x,op,{},token)).status,403);
    assert.equal((await post(x,op,{},OWNER,{
      Origin:'https://outside.example.invalid'
    })).status,403);
  }
  assert.equal((await post(x,'plan',{...x.input,extra_command:'git push'})).status,400);
  assert.equal((await post(x,'plan',{
    ...x.input,acknowledge_historical_rights:false
  })).status,403);
  const plan=await x.client.planCarryForward(x.input);
  for(const patch of [
    {confirm_plan_sha256:'a'.repeat(64)},
    {confirm_source_candidate_sha256:'a'.repeat(64)},
    {confirm_destination_build:'wrong build'},
    {acknowledge_create_draft:false}
  ]){
    assert.equal((await post(x,'apply',{
      plan,...confirmation(plan),...patch
    })).status,403);
  }
  assert.equal((await post(x,'apply',{
    plan,...confirmation(plan),repository_path:'/private'
  })).status,400);
  assert.equal(x.app.list('deliverable',x.release.id).length,0);
});

test('R70 cross-product, same-build, wrong target, changed locale/role/flag or active destination deny proposal',async t=>{
  const x=await fixture(t);
  const extra=(await execute(x.app,'entity.create',{kind:'product',data:{
    name:'Foreign owned product'
  }})).entity;
  const foreign=(await execute(x.app,'entity.create',{kind:'release',data:{
    product_id:extra.id,name:'Foreign draft',build:'other',status:'draft'
  }})).entity;
  assert.throws(()=>prepareCarryForward(x.app,{
    ...x.input,destination_release_id:foreign.id
  }),{code:'PermissionDenied'});
  assert.throws(()=>prepareCarryForward(x.app,{
    ...x.input,destination_target_id:x.old.target.id
  }),{code:'PermissionDenied'});
  const bad=(await execute(x.app,'entity.create',{kind:'target',data:{
    ...x.target.data,name:'Unexpected different target',region:'US'
  }})).entity;
  assert.throws(()=>prepareCarryForward(x.app,{
    ...x.input,destination_target_id:bad.id
  }),{code:'StaleReference'});
  await execute(x.app,'entity.update',{
    id:x.release.id,expected:x.release.version,
    data:{...x.release.data,status:'active'}
  });
  assert.throws(()=>prepareCarryForward(x.app,x.input),{
    code:'PermissionDenied'
  });
});

test('R70 stale source revokes old plan, new approval review also invalidates original SHA',async t=>{
  const x=await fixture(t),p=await x.client.planCarryForward(x.input);
  const original=x.old.deliverable;
  await execute(x.app,'entity.update',{
    id:original.id,expected:original.version,
    data:{...original.data,content:'Edited historical document'}
  });
  const response=await post(x,'apply',{plan:p,...confirmation(p)});
  assert.equal(response.status,403);
  assert.equal(x.app.list('deliverable',x.release.id).length,0);
});
test('R70 claim-bearing historical text is not cloned without explicit fresh authoring',async t=>{
  const x=await fixture(t),old=x.old;
  const claim=(await execute(x.app,'entity.create',{kind:'claim',data:{
    release_id:old.release.id,target_id:old.target.id,
    name:'Owned claim',text:'Needs proof',category:'feature',evidence_ids:[]
  }})).entity;
  const doc=(await execute(x.app,'entity.create',{kind:'deliverable',data:{
    ...old.deliverable.data,name:'Claim-bearing docs',claim_ids:[claim.id]
  }})).entity;
  const artifact=(await execute(x.app,'deliverable.render',{id:doc.id})).entity;
  const candidate=(await execute(x.app,'candidate.freeze',{
    release_id:old.release.id,name:'Claim-bound candidate',
    artifact_ids:[artifact.id],destination:'r70-rejected',
    contract:{version:'owned-test',required_reviewers:1,
      require_claims_verified:false}
  })).entity;
  await execute(x.app,'candidate.review',{
    id:candidate.id,candidate_sha256:candidate.data.candidate_sha256,
    decision:'approve-editorial',comment:'Only human editorial acceptance'
  });
  assert.throws(()=>prepareCarryForward(x.app,{
    ...x.input,source_candidate_id:candidate.id,source_artifact_id:artifact.id
  }),{code:'PolicyDenied'});
});

test('R70 tampered plan, destination revision drift and exact human draft edit block no mutation',async t=>{
  const x=await fixture(t),p=await x.client.planCarryForward(x.input);
  assert.equal((await post(x,'apply',{plan:{
    ...p,destination_name:'Altered'
  },...confirmation(p)})).status,409);
  await execute(x.app,'entity.update',{
    id:x.target.id,expected:x.target.version,
    data:{...x.target.data,viewport:{...x.target.data.viewport,width:390}}
  });
  assert.equal((await post(x,'apply',{plan:p,...confirmation(p)})).status,409);
  assert.equal(x.app.list('deliverable',x.release.id).length,0);
});

test('R70 interrupted Native write leaves a partial draft that is recovered by same plan only',async t=>{
  const x=await fixture(t),p=await x.client.planCarryForward(x.input);
  const original=x.app.store.create.bind(x.app.store);
  let failOnce=true;
  x.app.store.create=(kind,...args)=>{
    if(kind==='relation'&&failOnce){failOnce=false;throw Error('Synthetic power loss before provenance');}
    return original(kind,...args);
  };
  assert.equal((await post(x,'apply',{plan:p,...confirmation(p)})).status,500);
  assert.equal((await x.client.inspectCarryForward(p)).state,
    'PARTIAL_NEEDS_RECONCILIATION');
  assert.equal(x.app.list('deliverable',x.release.id).length,1);
  const recovered=await x.client.applyCarryForward(p,confirmation(p));
  assert.equal(recovered.created_deliverable,false);
  assert.equal(recovered.created_relation,true);
  assert.equal(recovered.state,'DRAFT_READY');
  assert.equal(x.app.list('deliverable',x.release.id).length,1);
  assert.equal(x.app.list('relation',x.release.id).length,1);
});

test('R70 lost HTTP reply uses inspect before an intentional same-plan replay, never auto-retries',async t=>{
  const x=await fixture(t),p=await x.client.planCarryForward(x.input);
  let sent=0;
  const client=new LaunchwrightClient({baseUrl:x.origin,token:OWNER,
    fetchImpl:async(url,options)=>{
      const response=await fetch(url,options);
      if(url.endsWith('/release-carry-forward/apply')){
        sent++;throw Error('Synthetic reply dropped AFTER Native commit');
      }
      return response;
    }
  });
  await assert.rejects(client.applyCarryForward(p,confirmation(p)),{
    code:'Unavailable'
  });
  assert.equal(sent,1);
  const readback=await x.client.inspectCarryForward(p);
  assert.equal(readback.state,'DRAFT_READY');
  assert.equal(sent,1);
  const recovery=await x.client.applyCarryForward(p,confirmation(p));
  assert.equal(recovery.recovered,true);
  assert.equal(x.app.list('relation',x.release.id).length,1);
});

test('R70 human edits or a stale exclusive lock prevent automatic clobber or reconciliation',async t=>{
  const x=await fixture(t),p=await x.client.planCarryForward(x.input);
  const lock=join(x.root,'.release-carry-forward.lock');
  writeFileSync(lock,'Unknown prior operator',{mode:0o600});
  assert.equal((await post(x,'apply',{plan:p,...confirmation(p)})).status,409);
  assert.equal(existsSync(lock),true);
  unlinkSync(lock);
  const created=await x.client.applyCarryForward(p,confirmation(p));
  const d=x.app.get(created.deliverable_id);
  await execute(x.app,'entity.update',{id:d.id,expected:d.version,
    data:{...d.data,content:'Human reviewed and changed content'}
  });
  assert.equal((await post(x,'apply',{plan:p,...confirmation(p)})).status,409);
  assert.equal(x.app.list('deliverable',x.release.id).length,1);
});

test('R70 a repeated editorial decision invalidates the old review fingerprint',async t=>{
  const x=await fixture(t);
  const plan=await x.client.planCarryForward(x.input);
  await execute(x.app,'candidate.review',{
    id:x.candidate.id,candidate_sha256:x.candidate.data.candidate_sha256,
    decision:'approve-editorial',comment:'Additional review arrived after planning'
  });
  const response=await post(x,'apply',{plan,...confirmation(plan)});
  assert.equal(response.status,409);
  assert.equal(x.app.list('deliverable',x.release.id).length,0);
});

test('R70 same-build destination cannot be misrepresented as a new release',async t=>{
  const x=await fixture(t);
  await execute(x.app,'entity.update',{
    id:x.release.id,expected:x.release.version,
    data:{...x.release.data,build:x.old.release.data.build}
  });
  assert.throws(()=>prepareCarryForward(x.app,x.input),{code:'InvalidArgument'});
  assert.equal(x.app.list('deliverable',x.release.id).length,0);
});
