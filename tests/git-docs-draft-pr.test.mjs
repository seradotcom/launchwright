// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync,spawnSync } from 'node:child_process';
import { mkdtempSync,mkdirSync,rmSync,writeFileSync,readFileSync } from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execute} from '../src/application.mjs';
import {prepareGitDocsBranch,applyGitDocsBranch} from '../src/git-docs-pr.mjs';
import {prepareGitDocsDraftPR,verifyGitDocsDraftPR,sendGitDocsDraftPR,
  createGithubDocsTransport} from '../src/git-docs-draft-pr.mjs';
import {setup,baseline} from './helpers.mjs';

const cwd=fileURLToPath(new URL('../',import.meta.url));
const REPO='ownedorg/owned-docs-fixture';
const git=(repo,...args)=>execFileSync('git',['-C',repo,...args],{
  encoding:'utf8',timeout:12000,env:{...process.env,GIT_TERMINAL_PROMPT:'0'}
}).trim();
async function fixture(t){
  const repo=mkdtempSync(join(tmpdir(),'launchwright-r41-git-'));
  t.after(()=>rmSync(repo,{recursive:true,force:true,maxRetries:5,retryDelay:50}));
  execFileSync('git',['init','-b','main',repo],{stdio:'ignore'});
  git(repo,'config','user.name','R41 Owned Fixture');
  git(repo,'config','user.email','r41@example.invalid');
  mkdirSync(join(repo,'docs'),{recursive:true});
  writeFileSync(join(repo,'docs','RELEASE.md'),'# Old docs\n');
  git(repo,'add','docs/RELEASE.md');
  git(repo,'commit','-m','Old docs');
  const {app,root}=setup(t),b=await baseline(app);
  const artifact=(await execute(app,'deliverable.render',{id:b.deliverable.id})).entity;
  const candidate=(await execute(app,'candidate.freeze',{
    release_id:b.release.id,name:'Exact docs review',
    artifact_ids:[artifact.id],destination:'owned-git-docs-draft',
    contract:{version:'r41',required_reviewers:1,require_claims_verified:false}
  })).entity;
  await execute(app,'candidate.review',{id:candidate.id,
    candidate_sha256:candidate.data.candidate_sha256,
    decision:'approve-editorial',comment:'Owned fixture editorial approval'});
  const branchPlan=prepareGitDocsBranch(app,{
    repository_root:repo,github_repository:REPO,base_branch:'main',
    docs_path:'docs/RELEASE.md',candidate_id:candidate.id,artifact_id:artifact.id,
    acknowledge_draft_only:true,acknowledge_unverified:true
  });
  const local=applyGitDocsBranch(app,branchPlan,repo,{
    confirm_plan_sha256:branchPlan.plan_sha256,
    confirm_candidate_sha256:branchPlan.candidate_sha256,
    confirm_base_commit_sha:branchPlan.base_commit_sha,
    acknowledge_local_git_write:true
  });
  const intent=prepareGitDocsDraftPR(app,branchPlan,repo,{
    title:'Draft release docs for review',
    editorial_note:'Review the exact Markdown; not public yet.',
    acknowledge_draft_only:true
  });
  const confirm={confirm_repository:REPO,
    confirm_branch_plan_sha256:branchPlan.plan_sha256,
    confirm_local_commit_sha:local.commit_sha,
    acknowledge_first_send:true};
  return{repo,root,app,b,artifact,candidate,branchPlan,local,intent,confirm};
}
class FakeGithub{
  constructor(f){
    this.base=f.branchPlan.base_commit_sha;
    this.head=f.local.commit_sha;
    this.pr=null;this.calls=[];this.failAfterCreate=false;
  }
  async getBaseSha(){this.calls.push('base');return this.base;}
  async getBranchSha(){this.calls.push('head');return this.head;}
  async getOpenPR(){this.calls.push('read');return this.pr?structuredClone(this.pr):null;}
  async createDraftPR(repo,payload){
    this.calls.push('create');
    this.pr={id:530,number:42,draft:true,state:'open',
      title:payload.title,body:payload.body,
      head:{ref:payload.head,sha:this.head,repo:{full_name:repo}},
      base:{ref:payload.base,sha:this.base,repo:{full_name:repo}},
      html_url:'https://github.com/'+repo+'/pull/42'};
    if(this.failAfterCreate)throw Error('Synthetic GitHub ACK lost after PR created');
    return structuredClone(this.pr);
  }
}
test('R41 private PR plan requires exact prior local branch, human candidate and explicit DRAFT consent',async t=>{
  const x=await fixture(t);
  const p=prepareGitDocsDraftPR(x.app,x.branchPlan,x.repo,{
    title:x.intent.title,editorial_note:x.intent.editorial_note,acknowledge_draft_only:true
  });
  assert.deepEqual(p,x.intent);
  assert.deepEqual(verifyGitDocsDraftPR(x.app,x.branchPlan,x.repo,p),p);
  assert.equal(p.github_pr_created,false);
  assert.equal(p.external_branch_push_performed,false);
  assert.equal(p.publication_authority,false);
  assert.equal(p.platform_authority,false);
  assert.equal(p.technical_state,'UNKNOWN');
  assert.ok(!JSON.stringify(p).includes(x.repo));
  assert.equal(git(x.repo,'rev-parse','HEAD'),x.branchPlan.base_commit_sha);
  assert.throws(()=>prepareGitDocsDraftPR(x.app,x.branchPlan,x.repo,{
    title:'Unreviewed',acknowledge_draft_only:false}),{code:'ConsentRequired'});
  assert.throws(()=>prepareGitDocsDraftPR(x.app,x.branchPlan,x.repo,{
    title:'Bad\nNewline',acknowledge_draft_only:true}),{code:'InvalidArgument'});
});

test('R41 remote draft cannot be created until separately manually pushed exact head and base exist',async t=>{
  const x=await fixture(t),remote=new FakeGithub(x);
  remote.head=null;
  await assert.rejects(sendGitDocsDraftPR(x.app,x.branchPlan,x.repo,x.intent,remote,x.confirm),
    {code:'StaleReference'});
  assert.ok(!remote.calls.includes('create'));
  remote.head=x.local.commit_sha;remote.base='a'.repeat(40);
  await assert.rejects(sendGitDocsDraftPR(x.app,x.branchPlan,x.repo,x.intent,remote,x.confirm),
    {code:'StaleReference'});
  assert.ok(!remote.calls.includes('create'));
});

test('R41 explicit once-only send creates a DRAFT PR, reads back exact title/body/repos/base/head then recovery is read-only',async t=>{
  const x=await fixture(t),remote=new FakeGithub(x);
  const receipt=await sendGitDocsDraftPR(x.app,x.branchPlan,x.repo,x.intent,remote,x.confirm);
  assert.equal(receipt.state,'REMOTE_DRAFT_CREATED');
  assert.equal(receipt.remote_pr_creation_performed,true);
  assert.equal(receipt.recovered,false);
  assert.equal(receipt.published,false);
  assert.equal(receipt.external_branch_push_performed,false);
  assert.equal(receipt.platform_authority,false);
  assert.equal(receipt.pr_number,42);
  assert.equal(remote.pr.draft,true);
  assert.equal(remote.pr.state,'open');
  assert.ok(remote.pr.body.includes(x.branchPlan.plan_sha256));
  assert.ok(remote.pr.body.includes(x.artifact.data.sha256));
  assert.equal(remote.calls.filter(c=>c==='create').length,1);
  const reread=await sendGitDocsDraftPR(x.app,x.branchPlan,x.repo,x.intent,remote,
    {...x.confirm,recover_only:true,acknowledge_first_send:false});
  assert.equal(reread.recovered,true);
  assert.equal(reread.remote_pr_creation_performed,false);
  assert.equal(remote.calls.filter(c=>c==='create').length,1);
  assert.equal(git(x.repo,'symbolic-ref','--short','HEAD'),'main');
});

test('R41 a lost external PR create reply refuses automatic retries; recover-only reconciles original remote DRAFT',async t=>{
  const x=await fixture(t),remote=new FakeGithub(x);
  remote.failAfterCreate=true;
  let caught=null;
  try{await sendGitDocsDraftPR(x.app,x.branchPlan,x.repo,x.intent,remote,x.confirm);}
  catch(err){caught=err;}
  assert.ok(caught);
  assert.equal(caught.code,'Unavailable');
  assert.equal(caught.outcomeKnown,false);
  assert.equal(remote.calls.filter(v=>v==='create').length,1);
  const recovery=await sendGitDocsDraftPR(x.app,x.branchPlan,x.repo,x.intent,
    remote,{...x.confirm,recover_only:true,acknowledge_first_send:false});
  assert.equal(recovery.recovered,true);
  assert.equal(remote.calls.filter(v=>v==='create').length,1);
});

test('R41 only read-only recovery can inspect absent PR: no create, and missing first-send consent refuses remote effects',async t=>{
  const x=await fixture(t),remote=new FakeGithub(x);
  await assert.rejects(sendGitDocsDraftPR(x.app,x.branchPlan,x.repo,x.intent,remote,
    {...x.confirm,recover_only:true}),{code:'NotFound'});
  assert.ok(!remote.calls.includes('create'));
  await assert.rejects(sendGitDocsDraftPR(x.app,x.branchPlan,x.repo,x.intent,remote,
    {...x.confirm,acknowledge_first_send:false}),{code:'ConsentRequired'});
  await assert.rejects(sendGitDocsDraftPR(x.app,x.branchPlan,x.repo,x.intent,remote,
    {...x.confirm,confirm_repository:'other/repo'}),{code:'ConsentRequired'});
  assert.equal(remote.pr,null);
});

test('R41 altered remote PR body, title, head, base, draft state, lifecycle or URL is rejected without clobber',async t=>{
  const x=await fixture(t);
  const make=async()=>{const fake=new FakeGithub(x);
    await sendGitDocsDraftPR(x.app,x.branchPlan,x.repo,x.intent,fake,x.confirm);
    return fake;};
  for(const changed of [
    pr=>pr.body+=' MALICIOUS',pr=>pr.title+=' changed',
    pr=>pr.head.sha='a'.repeat(40),
    pr=>pr.head.repo.full_name='another/repo',
    pr=>pr.base.ref='main2',
    pr=>pr.base.sha='a'.repeat(40),
    pr=>pr.base.repo.full_name='another/repo',
    pr=>pr.draft=false,
    pr=>pr.state='closed',
    pr=>pr.html_url='https://evil.example/pull/42'
  ]){
    const remote=await make();changed(remote.pr);
    await assert.rejects(sendGitDocsDraftPR(x.app,x.branchPlan,x.repo,x.intent,remote,
      {...x.confirm,recover_only:true}),{code:'Conflict'});
    assert.equal(remote.calls.filter(k=>k==='create').length,1);
  }
});

test('R41 saved intent tampering, wrong local Git branch or moved Git base denies remote operations',async t=>{
  const x=await fixture(t),remote=new FakeGithub(x);
  await assert.rejects(sendGitDocsDraftPR(x.app,x.branchPlan,x.repo,
    {...x.intent,editorial_note:'Changed note'},remote,x.confirm),{code:'Conflict'});
  assert.deepEqual(remote.calls,[]);
  git(x.repo,'branch','-f',x.branchPlan.branch,'main');
  await assert.rejects(sendGitDocsDraftPR(x.app,x.branchPlan,x.repo,x.intent,
    remote,x.confirm),{code:'Conflict'});
  assert.deepEqual(remote.calls,[]);
});

test('R41 bounded GitHub adapter uses only exact GET and draft POST; checks historical closed PRs',async t=>{
  const calls=[];
  const run=(args,{input}={})=>{
    calls.push({args:[...args],input});
    if(args[1].includes('/branches/'))return{commit:{sha:'a'.repeat(40)}};
    if(args[1].includes('/git/ref/'))return{object:{sha:'b'.repeat(40)}};
    if(args[1].includes('/pulls?'))return[];
    if(args.includes('POST'))return{number:42};
    throw Error('Unrecognized bounded GH API');
  };
  const provider=createGithubDocsTransport(run);
  assert.equal(await provider.getBaseSha(REPO,'main'),'a'.repeat(40));
  assert.equal(await provider.getBranchSha(REPO,'launchwright/docs-123'),'b'.repeat(40));
  assert.equal(await provider.getOpenPR(REPO,'launchwright/docs-123','main'),null);
  assert.ok(calls[2].args[1].includes('state=all'));
  assert.ok(calls[2].args[1].includes('head=ownedorg%3Alaunchwright'));
  await provider.createDraftPR(REPO,{
    title:'Owned synthetic draft',body:'Owned notes',head:'launchwright/docs-123',base:'main',draft:true
  });
  assert.ok(calls[3].args.includes('POST'));
  assert.equal(JSON.parse(calls[3].input).draft,true);
  await assert.rejects(provider.createDraftPR(REPO,{draft:false}),{code:'PermissionDenied'});
});

test('R41 CLI plan creates a private immutable intent and malformed confirm never contacts GitHub',async t=>{
  const x=await fixture(t);
  const sourcePlan=join(x.root,'r40-private.json'),out=join(x.root,'r41-private.json');
  writeFileSync(sourcePlan,JSON.stringify(x.branchPlan),{mode:0o600});
  const cli=(argv)=>spawnSync(process.execPath,['scripts/git-docs-draft-pr.mjs',...argv],
    {cwd,encoding:'utf8',timeout:20000});
  const args=['plan','--state',x.root,'--repo-root',x.repo,
    '--branch-plan',sourcePlan,'--title','Docs DRAFT for reviewer',
    '--note','Owned fixture', '--out',out,'--acknowledge-draft-only'];
  const r=cli(args);
  assert.equal(r.status,0,r.stdout+r.stderr);
  const intent=JSON.parse(readFileSync(out,'utf8'));
  assert.equal(intent.repository,REPO);
  assert.equal(intent.local_branch_commit_sha,x.local.commit_sha);
  assert.notEqual(cli(args).status,0,'Private intent may not be overwritten');
  const bad=cli(['send','--state',x.root,'--repo-root',x.repo,
    '--branch-plan',sourcePlan,'--intent',out,
    '--confirm-repo','other/repo',
    '--confirm-branch-plan',x.branchPlan.plan_sha256,
    '--confirm-commit',x.local.commit_sha]);
  assert.notEqual(bad.status,0);
  assert.match(bad.stdout,/ConsentRequired/u);
});
