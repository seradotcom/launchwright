// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {createCarryForwardBatchController} from '../web/carry-forward-batch-ui.mjs';

const source={id:'rel-old',data:{name:'Old',build:'A'}};
const destination={id:'rel-new',data:{name:'New',build:'B'}};
const targets=[
 {id:'old-target',data:{name:'en-US',release_id:'rel-old',
  ui_locale:'en-US',editorial_locale:'en-US',role:'basic',plan:'free',
  region:'MX',flags:{foo:false}}},
 {id:'new-target',data:{name:'en-US',release_id:'rel-new',
  ui_locale:'en-US',editorial_locale:'en-US',role:'basic',plan:'free',
  region:'MX',flags:{foo:false}}}
];
const rows=['a','b','c'].map(n=>({
 artifact:{id:'artifact-'+n,data:{name:'Artifact '+n,
   sha256:n.repeat(64),mime:'text/markdown',release_id:'rel-old'}},
 document:{id:'doc-'+n,data:{name:'Notes '+n,
   target_id:'old-target',release_id:'rel-old',
   claim_ids:n==='c'?['claim-old']:[],copy_block_ids:[]}}
}));
const candidate={id:'candidate-historical',data:{name:'Prior reviewed',
  release_id:'rel-old',manifest:{artifacts:rows.map(row=>({
    id:row.artifact.id,mime:'text/markdown',
    deliverable_id:row.document.id
  }))}}};
const plan={schema_version:'launchwright-carry-forward-batch-plan/1',
  source_candidate_id:candidate.id,source_candidate_sha256:'f'.repeat(64),
  destination_release_id:destination.id,destination_build:'B',
  document_count:2,plan_sha256:'e'.repeat(64),
  plans:[0,1].map(i=>({
    source_artifact_id:rows[i].artifact.id,
    source_artifact_sha256:rows[i].artifact.data.sha256,
    destination_target_id:'new-target',destination_name:rows[i].document.data.name,
    created_name:rows[i].document.data.name+' · review 1234',
    plan_sha256:(''+i).repeat(64)
  }))
};
const savedStatus={state:'BATCH_READY',
  plan_sha256:plan.plan_sha256,completed_documents:2,
  total_documents:2,requires_manual_reconciliation:false,
  rows:plan.plans.map(p=>({...p,state:'DRAFT_READY',deliverable_id:'new-'+p.source_artifact_id}))};
function testApi(){
 const calls=[];
 return{calls,api:{
  planCarryForwardBatch:async data=>{calls.push(['plan',data]);return plan;},
  inspectCarryForwardBatch:async data=>{calls.push(['inspect',data]);return savedStatus;},
  applyCarryForwardBatch:async(data,confirm)=>{calls.push(['apply',data,confirm]);
    return{...savedStatus,created_documents:2};}
 }};
}
const render=ui=>ui.render([source,destination],[candidate],
  rows.map(x=>x.artifact),targets,rows.map(x=>x.document),destination.id);
test('R71 UI filters claim-linked Markdown, keeps selected items in session memory and never submits on render',async()=>{
 const mock=testApi(),ui=createCarryForwardBatchController(mock.api);
 assert.equal(ui.plan,null);
 assert.ok(render(ui).includes('Choose historical frozen Candidate'));
 ui.chooseCandidate(candidate.id);
 assert.ok(render(ui).includes(rows[0].artifact.id));
 assert.ok(render(ui).includes(rows[1].artifact.id));
 assert.ok(!render(ui).includes('data-batch-toggle="artifact-c"'));
 ui.toggle(rows[0].artifact.id,true);
 ui.toggle(rows[1].artifact.id,true);
 const html=render(ui);
 assert.ok(html.includes('new-target'));
 assert.ok(html.includes('Notes a'));
 assert.deepEqual(mock.calls,[]);
 await assert.rejects(ui.prepare(destination.id,{rights:true,review:false}));
 assert.deepEqual(mock.calls,[]);
 await ui.prepare(destination.id,{rights:true,review:true});
 assert.equal(mock.calls.length,1);
 const request=mock.calls[0][1];
 assert.equal(request.items.length,2);
 assert.ok(request.items.every(x=>x.destination_target_id==='new-target'));
 assert.equal(request.destination_release_id,destination.id);
 assert.equal(ui.downloadPlan(),JSON.stringify(plan,null,2)+'\n');
});
test('R71 UI restore/inspect is read-only; apply requires consent and verifies durable readback',async()=>{
 const mock=testApi(),ui=createCarryForwardBatchController(mock.api);
 await assert.rejects(ui.apply({acknowledge_create_all_drafts:true}));
 await ui.restore(plan);
 assert.equal(ui.status.state,'BATCH_READY');
 assert.equal(ui.candidateId,candidate.id);
 assert.equal(ui.selected.length,2);
 assert.equal(mock.calls.at(-1)[0],'inspect');
 await assert.rejects(ui.apply({acknowledge_create_all_drafts:false}));
 assert.equal(mock.calls.filter(c=>c[0]==='apply').length,0);
 await ui.apply({
   confirm_plan_sha256:plan.plan_sha256,
   confirm_source_candidate_sha256:plan.source_candidate_sha256,
   confirm_destination_build:'B',acknowledge_create_all_drafts:true
 });
 assert.equal(mock.calls.filter(c=>c[0]==='apply').length,1);
 assert.equal(mock.calls.at(-1)[0],'inspect');
 assert.ok(render(ui).includes('BATCH_READY'));
 await ui.inspect();
 assert.equal(mock.calls.filter(c=>c[0]==='apply').length,1);
 ui.clear();
 assert.equal(ui.plan,null);
 assert.equal(ui.selected.length,0);
});
test('R71 UI protects against unknown selectors and escapes metadata before rendering',async()=>{
 const mock=testApi(),ui=createCarryForwardBatchController(mock.api);
 ui.chooseCandidate(candidate.id);
 ui.toggle(rows[0].artifact.id,true);
 assert.throws(()=>ui.update('absent','destination_name','X'));
 assert.throws(()=>ui.update(rows[0].artifact.id,'shell','git push'));
 ui.update(rows[0].artifact.id,'destination_name','<img src=x onerror=alert(1)>');
 const h=render(ui);
 assert.ok(!h.includes('<img src=x'));
 assert.ok(h.includes('&lt;img'));
 await assert.rejects(ui.restore({...plan,plan_sha256:'forged'}));
 assert.equal(mock.calls.length,0);
 ui.chooseCandidate('');
 assert.equal(ui.selected.length,0);
});
