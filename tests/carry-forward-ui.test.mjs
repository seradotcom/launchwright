// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {createCarryForwardController} from '../web/carry-forward-ui.mjs';
const h='a'.repeat(64),s='b'.repeat(64);
const releaseA={id:'release-old',data:{name:'Historical',build:'A'}};
const releaseB={id:'release-new',data:{name:'Next',build:'B'}};
const candidate={id:'candidate-1',data:{name:'Candidate A',
  release_id:releaseA.id,manifest:{artifact_ids:['artifact-1']}}};
const artifact={id:'artifact-1',data:{name:'Source note',
  mime:'text/markdown; charset=utf-8',release_id:releaseA.id}};
const target={id:'target-new',data:{name:'en-US',
  release_id:releaseB.id}};
const plan={schema_version:'launchwright-release-carry-forward-plan/1',
  source_candidate_id:candidate.id,source_artifact_id:artifact.id,
  source_candidate_sha256:s,source_artifact_sha256:'c'.repeat(64),
  source_build:'A',destination_build:'B',destination_release_id:releaseB.id,
  destination_target_id:target.id,
  destination_name:'Release notes',created_name:'Release notes · review abcd',
  plan_sha256:h};
const status={state:'DRAFT_READY',deliverable_id:'doc-new',
  relation_id:'relation-new',technical_state:'UNKNOWN'};
function fake(){
 const calls=[];
 return{calls,api:{
   planCarryForward:async input=>{calls.push(['plan',input]);return plan;},
   inspectCarryForward:async p=>{calls.push(['inspect',p]);return status;},
   applyCarryForward:async(p,confirm)=>{calls.push(['apply',p,confirm]);return status;}
 }};
}
const view=(ctl)=>ctl.render([releaseA,releaseB],[candidate],[artifact],
  [target],releaseB.id);
test('R70 UI supports explicit selections, filters frozen source artifacts and never sends on render',async()=>{
 const f=fake(),ui=createCarryForwardController(f.api);
 assert.equal(ui.plan,null);
 let html=view(ui);
 assert.ok(html.includes('Historical frozen Candidate'));
 assert.ok(!html.includes('artifact-1'));
 ui.choose('source_candidate_id','candidate-1');
 html=view(ui);
 assert.ok(html.includes('artifact-1'));
 ui.choose('source_artifact_id','artifact-1');
 ui.choose('destination_target_id','target-new');
 assert.deepEqual(f.calls,[]);
 await assert.rejects(ui.prepare(releaseB.id,{rights:true,recheck:false}));
 await ui.prepare(releaseB.id,{rights:true,recheck:true});
 assert.equal(f.calls.length,1);
 assert.equal(f.calls[0][1].destination_release_id,releaseB.id);
 assert.equal(ui.downloadPlan(),JSON.stringify(plan,null,2)+'\n');
 assert.ok(view(ui).includes('Claims, evidence'));
 assert.ok(!JSON.stringify(f.calls).includes('private_token'));
});
test('R70 UI needs a separate affirmative write and can inspect/recover without reissuing',async()=>{
 const f=fake(),ui=createCarryForwardController(f.api);
 await assert.rejects(ui.apply({acknowledge_create_draft:true}));
 await ui.restore(plan);
 assert.equal(f.calls.at(-1)[0],'inspect');
 assert.equal(ui.status.state,'DRAFT_READY');
 await assert.rejects(ui.apply({acknowledge_create_draft:false}));
 assert.equal(f.calls.filter(c=>c[0]==='apply').length,0);
 await ui.apply({
   confirm_plan_sha256:h,confirm_source_candidate_sha256:s,
   confirm_destination_build:'B',acknowledge_create_draft:true
 });
 assert.equal(f.calls.filter(c=>c[0]==='apply').length,1);
 assert.equal(ui.status.deliverable_id,'doc-new');
 await ui.inspect();
 assert.equal(f.calls.filter(c=>c[0]==='apply').length,1);
 ui.clear();assert.equal(ui.plan,null);assert.equal(ui.status,null);
});
test('R70 UI HTML escapes operator-controlled candidate/target/title strings',async()=>{
 const f=fake(),ui=createCarryForwardController(f.api);
 const malicious={...candidate,data:{...candidate.data,
   name:'<img src=x onerror=alert(1)>'}};
 const html=ui.render([releaseA,releaseB],[malicious],[artifact],
   [target],releaseB.id);
 assert.ok(!html.includes('<img'));
 assert.ok(html.includes('&lt;img'));
 assert.ok(!html.includes('onerror=alert(1)>'));
 await assert.rejects(ui.restore({...plan,plan_sha256:'bad'}));
 assert.throws(()=>ui.choose('not_a_field','x'));
 await assert.rejects(ui.prepare(null));
});
