// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {setup} from './helpers.mjs';
import {existsSync,writeFileSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {createR68Fixture,ownedGit} from './git-docs-web-fixture.mjs';
import {createAppServer} from '../src/server.mjs';
import {LaunchwrightClient} from '../client/index.mjs';
import {prepareGitDocsBranch,applyGitDocsBranch} from '../src/git-docs-pr.mjs';

const OWNER='r69-owned-local-browser-test-owner';
const CONSUMER='r69-external-consumer-bearer-secret';
class OwnedFakeGitHub{
  constructor(){this.base=null;this.head=null;this.pr=null;this.created=0;
    this.reads=0;this.failAfterCreate=false;}
  async getBaseSha(){this.reads++;return this.base;}
  async getBranchSha(){this.reads++;return this.head;}
  async getOpenPR(){this.reads++;return this.pr?structuredClone(this.pr):null;}
  async createDraftPR(repo,input){
    this.created++;
    this.pr={number:73,title:input.title,body:input.body,draft:true,state:'open',
      html_url:'https://github.com/'+repo+'/pull/73',
      head:{ref:input.head,sha:this.head,repo:{full_name:repo}},
      base:{ref:input.base,sha:this.base,repo:{full_name:repo}}};
    if(this.failAfterCreate)throw Error('Owned injected GitHub lost ACK');
    return structuredClone(this.pr);
  }
}
async function fixture(t){
  const{app,root}=setup(t),owned=await createR68Fixture(app);
  t.after(()=>owned.cleanup());
  const branchPlan=prepareGitDocsBranch(app,owned.planInput);
  const branch=applyGitDocsBranch(app,branchPlan,owned.repository_root,{
    confirm_plan_sha256:branchPlan.plan_sha256,
    confirm_candidate_sha256:branchPlan.candidate_sha256,
    confirm_base_commit_sha:branchPlan.base_commit_sha,
    acknowledge_local_git_write:true
  });
  const remote=new OwnedFakeGitHub();
  remote.base=branchPlan.base_commit_sha;
  remote.head=branch.commit_sha; // CI injects verified owned refs, not real push.
  const server=createAppServer(app,{port:0,token:OWNER,githubDraftTransport:remote,
    bearerPrincipals:[{principal:'outside-69',token:CONSUMER,scopes:['consume']}]});
  const origin=await server.listen();
  t.after(()=>server.close());
  const client=new LaunchwrightClient({baseUrl:origin,token:OWNER});
  const selection={repository_root:owned.repository_root,branch_plan:branchPlan,
    title:'Draft R69 synthetic release notes',editorial_note:'Human review only',
    acknowledge_draft_only:true};
  const original=(await client.planLocalGitDocsDraft(selection)).intent;
  const confirmation={
    confirm_repository:original.repository,
    confirm_branch_plan_sha256:original.branch_plan_sha256,
    confirm_local_commit_sha:original.local_branch_commit_sha
  };
  return{...owned,root,app,branchPlan,branch,remote,server,origin,client,selection,
    original,confirmation};
}
async function post(f,action,payload,token=OWNER,headers={}){
  return fetch(f.origin+'/api/v1/local-git-docs-draft/'+action,{
    method:'POST',
    headers:{'Content-Type':'application/json',Authorization:'Bearer '+token,
      ...headers},body:JSON.stringify(payload)
  });
}
test('R69 preparing a Draft intent verifies current R40 Native branch and contacts no GitHub endpoint',async t=>{
  const x=await fixture(t),reads=x.remote.reads;
  const one=await x.client.planLocalGitDocsDraft(x.selection);
  const two=await x.client.planLocalGitDocsDraft(x.selection);
  assert.deepEqual(one,two);
  assert.equal(one.intent.intent_sha256,x.original.intent_sha256);
  assert.equal(one.intent.local_branch_commit_sha,x.branch.commit_sha);
  assert.equal(one.intent.candidate_sha256,x.owned?.candidate?.data?.candidate_sha256??
    x.candidate.data.candidate_sha256);
  assert.equal(one.intent.external_branch_push_performed,false);
  assert.equal(one.intent.github_pr_created,false);
  assert.equal(one.published,false);
  assert.equal(one.intent.platform_authority,false);
  assert.equal(x.remote.reads,reads);assert.equal(x.remote.created,0);
  assert.ok(!JSON.stringify(one).includes(x.repository_root));
});
test('R69 rejects external consumers, cross origin, extra fields, missing consent and wrong confirmations',async t=>{
  const x=await fixture(t);
  for(const action of ['plan','send','recover']){
    assert.equal((await post(x,action,{},CONSUMER)).status,403);
    assert.equal((await post(x,action,{},'invalid')).status,403);
    assert.equal((await post(x,action,{},OWNER,
      {Origin:'https://unauthorized.example.invalid'})).status,403);
  }
  assert.equal((await post(x,'plan',{
    ...x.selection,arbitrary_command:'git push'})).status,400);
  assert.equal((await post(x,'plan',{
    ...x.selection,acknowledge_draft_only:false})).status,403);
  const req={repository_root:x.repository_root,branch_plan:x.branchPlan,
    intent:x.original,...x.confirmation,
    acknowledge_remote_branch_pushed:true,acknowledge_first_send:true};
  for(const patch of [
    {confirm_repository:'wrong/repo'},
    {confirm_branch_plan_sha256:'a'.repeat(64)},
    {confirm_local_commit_sha:'b'.repeat(40)},
    {acknowledge_remote_branch_pushed:false},
    {acknowledge_first_send:false}
  ]){
    const res=await post(x,'send',{...req,...patch});
    assert.equal(res.status,403);
  }
  assert.equal(x.remote.created,0);assert.equal(x.remote.reads,0);
});
test('R69 real UI transport first-send creates exactly one bounded remote DRAFT and recover never POSTs',async t=>{
  const x=await fixture(t);
  const req={repository_root:x.repository_root,branch_plan:x.branchPlan,
    intent:x.original,...x.confirmation,
    acknowledge_remote_branch_pushed:true,acknowledge_first_send:true};
  const receipt=await x.client.sendLocalGitDocsDraft(req);
  assert.equal(receipt.state,'REMOTE_DRAFT_CREATED');
  assert.equal(receipt.remote_pr_creation_performed,true);
  assert.equal(receipt.recovered,false);
  assert.equal(receipt.published,false);
  assert.equal(receipt.approved_merge_performed,false);
  assert.equal(receipt.external_branch_push_performed,false);
  assert.equal(receipt.platform_authority,false);
  assert.equal(x.remote.created,1);
  assert.equal(x.remote.pr.draft,true);
  assert.ok(x.remote.pr.body.includes(x.original.intent_sha256));
  const recovery=await x.client.recoverLocalGitDocsDraft({
    repository_root:x.repository_root,branch_plan:x.branchPlan,
    intent:x.original,...x.confirmation
  });
  assert.equal(recovery.state,'REMOTE_DRAFT_CREATED');
  assert.equal(recovery.recovered,true);
  assert.equal(recovery.remote_pr_creation_performed,false);
  assert.equal(x.remote.created,1);
  assert.equal(ownedGit(x.repository_root,'rev-parse','HEAD'),x.branchPlan.base_commit_sha);
});
test('R69 remote head/base missing or moved denies creation, even if authorized by operator',async t=>{
  const x=await fixture(t);
  const req={repository_root:x.repository_root,branch_plan:x.branchPlan,
    intent:x.original,...x.confirmation,
    acknowledge_remote_branch_pushed:true,acknowledge_first_send:true};
  x.remote.head=null;
  await assert.rejects(x.client.sendLocalGitDocsDraft(req),{code:'StaleReference'});
  x.remote.head=x.branch.commit_sha;x.remote.base='a'.repeat(40);
  await assert.rejects(x.client.sendLocalGitDocsDraft(req),{code:'StaleReference'});
  assert.equal(x.remote.created,0);
});
test('R69 missing remote reply after POST requires read-only recovery and preserves original GitHub PR',async t=>{
  const x=await fixture(t);
  const req={repository_root:x.repository_root,branch_plan:x.branchPlan,
    intent:x.original,...x.confirmation,
    acknowledge_remote_branch_pushed:true,acknowledge_first_send:true};
  x.remote.failAfterCreate=true;
  await assert.rejects(x.client.sendLocalGitDocsDraft(req),{
    code:'Unavailable',outcomeKnown:false
  });
  assert.equal(x.remote.created,1);
  const recovered=await x.client.recoverLocalGitDocsDraft({
    repository_root:x.repository_root,branch_plan:x.branchPlan,
    intent:x.original,...x.confirmation
  });
  assert.equal(recovered.recovered,true);
  assert.equal(x.remote.created,1);
});
test('R69 recover-only rejects absent, tampered and non-DRAFT remote PRs without re-creation',async t=>{
  const x=await fixture(t),body={
    repository_root:x.repository_root,branch_plan:x.branchPlan,
    intent:x.original,...x.confirmation};
  await assert.rejects(x.client.recoverLocalGitDocsDraft(body),{code:'NotFound'});
  assert.equal(x.remote.created,0);
  await x.client.sendLocalGitDocsDraft({...body,
    acknowledge_remote_branch_pushed:true,acknowledge_first_send:true});
  x.remote.pr.draft=false;
  await assert.rejects(x.client.recoverLocalGitDocsDraft(body),{code:'Conflict'});
  x.remote.pr.draft=true;x.remote.pr.body+=' injected change';
  await assert.rejects(x.client.recoverLocalGitDocsDraft(body),{code:'Conflict'});
  assert.equal(x.remote.created,1);
  await assert.rejects(x.client.sendLocalGitDocsDraft({
    ...body,intent:{...x.original,title:'Forged'},
    acknowledge_remote_branch_pushed:true,acknowledge_first_send:true
  }),{code:'Conflict'});
  assert.equal(x.remote.created,1);
});

test('R69 state-scoped exclusive lock blocks overlapping Draft first-send and recovery without contacting GitHub',async t=>{
  const x=await fixture(t);
  const path=join(x.root,'.git-docs-draft-remote.lock');
  const request={repository_root:x.repository_root,branch_plan:x.branchPlan,
    intent:x.original,...x.confirmation,
    acknowledge_first_send:true,acknowledge_remote_branch_pushed:true};
  writeFileSync(path,'Another operator or crashed uncertain result',{mode:0o600});
  await assert.rejects(x.client.sendLocalGitDocsDraft(request),{code:'Conflict'});
  await assert.rejects(x.client.recoverLocalGitDocsDraft({
    repository_root:x.repository_root,branch_plan:x.branchPlan,
    intent:x.original,...x.confirmation
  }),{code:'Conflict'});
  assert.equal(x.remote.created,0);
  assert.equal(x.remote.reads,0);
  assert.equal(existsSync(path),true,'Unknown writer lock is never stolen');
  unlinkSync(path);
  const readOnly=await x.client.recoverLocalGitDocsDraft({
    repository_root:x.repository_root,branch_plan:x.branchPlan,
    intent:x.original,...x.confirmation
  }).catch(e=>e);
  assert.equal(readOnly.code,'NotFound');
  assert.equal(existsSync(path),false);
});
