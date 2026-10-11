// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {createGitDocsDraftController} from '../web/git-docs-draft-ui.mjs';
const r40={plan_sha256:'a'.repeat(64),branch:'launchwright/docs-test'};
const intent={
 schema_version:'launchwright-git-docs-draft-pr-intent/1',
 intent_sha256:'b'.repeat(64),branch_plan_sha256:r40.plan_sha256,
 local_branch_commit_sha:'c'.repeat(40),
 title:'Approved Draft only',repository:'owned-org/repo',
 head_branch:r40.branch,technical_state:'UNKNOWN',
 github_pr_created:false,published:false
};
const receipt={state:'REMOTE_DRAFT_CREATED',pr_number:2,
 pr_url:'https://github.com/owned-org/repo/pull/2',
 recovered:false,remote_pr_creation_performed:true};
const make=()=>{
 const calls=[];
 return{calls,api:{
   planLocalGitDocsDraft:async x=>{calls.push(['plan',x]);return{intent};},
   sendLocalGitDocsDraft:async x=>{calls.push(['send',x]);return receipt;},
   recoverLocalGitDocsDraft:async x=>{calls.push(['recover',x]);return{
     ...receipt,recovered:true,remote_pr_creation_performed:false
   };}
 }};
};
test('R69 UI cannot auto-create a PR, stores no branch pathname and escapes metadata',async()=>{
 const x=make(),ctl=createGitDocsDraftController(x.api);
 assert.equal(ctl.plan,null);
 await assert.rejects(ctl.prepare(r40,'/private/repo',{
   title:'Test',editorial_note:'review',acknowledge_draft_only:false
 }));
 assert.equal(x.calls.length,0);
 await ctl.prepare(r40,'/private/repo',{
   title:'Test',editorial_note:'review',acknowledge_draft_only:true
 });
 assert.deepEqual(x.calls.map(c=>c[0]),['plan']);
 const html=ctl.render(r40,{state:'LOCAL_BRANCH_READY'});
 assert.ok(html.includes(intent.intent_sha256));
 assert.ok(!html.includes('/private/repo'));
 assert.ok(html.includes('NOT SENT'));
 assert.equal(ctl.downloadIntent(),JSON.stringify(intent,null,2)+'\n');
 assert.equal(x.calls.length,1);
});
test('R69 UI send requires manual push/first-send, recovery only reads and never resends',async()=>{
 const x=make(),ctl=createGitDocsDraftController(x.api);
 await ctl.prepare(r40,'/private/repo',{
   title:'T',editorial_note:'',acknowledge_draft_only:true
 });
 await assert.rejects(ctl.send({acknowledge_first_send:false,
   acknowledge_remote_branch_pushed:true}));
 assert.deepEqual(x.calls.map(c=>c[0]),['plan']);
 const result=await ctl.send({
   confirm_repository:intent.repository,
   confirm_branch_plan_sha256:intent.branch_plan_sha256,
   confirm_local_commit_sha:intent.local_branch_commit_sha,
   acknowledge_first_send:true,acknowledge_remote_branch_pushed:true
 });
 assert.equal(result.state,'REMOTE_DRAFT_CREATED');
 assert.deepEqual(x.calls.map(c=>c[0]),['plan','send']);
 const recovered=await ctl.recover();
 assert.equal(recovered.recovered,true);
 assert.deepEqual(x.calls.map(c=>c[0]),['plan','send','recover']);
 assert.ok(ctl.render(r40,{state:'LOCAL_BRANCH_READY'}).includes('https://github.com/'));
 ctl.render({plan_sha256:'d'.repeat(64)},{state:'LOCAL_BRANCH_READY'});
 assert.equal(ctl.plan,null);
});
test('R69 imported intent must exactly match server-recomputed local Git/Native source',async()=>{
 const x=make(),ctl=createGitDocsDraftController(x.api);
 await assert.rejects(ctl.restore({...intent,intent_sha256:'INVALID'},r40,'/private'));
 await assert.rejects(ctl.restore(intent,{plan_sha256:'f'.repeat(64)},'/private'));
 await ctl.restore(intent,r40,'/private');
 assert.equal(x.calls.at(-1)[0],'plan');
 assert.equal(ctl.plan.intent_sha256,intent.intent_sha256);
 ctl.clear();assert.equal(ctl.plan,null);
});
