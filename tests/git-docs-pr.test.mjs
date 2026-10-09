// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync,spawnSync } from 'node:child_process';
import {createHash} from 'node:crypto';
import { mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execute } from '../src/application.mjs';
import { prepareGitDocsBranch,verifyGitDocsPlan,applyGitDocsBranch } from '../src/git-docs-pr.mjs';
import { setup,baseline } from './helpers.mjs';
const cwd=fileURLToPath(new URL('../',import.meta.url));
const REPO='ownedorg/owned-docs-fixture';
const git=(dir,...argv)=>execFileSync('git',['-C',dir,...argv],{
  encoding:'utf8',env:{...process.env,GIT_TERMINAL_PROMPT:'0'},
  timeout:12000,maxBuffer:1048576
}).trim();
function ownedGit(t){
  const dir=mkdtempSync(join(tmpdir(),'launchwright-r40-owned-git-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true,maxRetries:5,retryDelay:50}));
  execFileSync('git',['init','-b','main',dir],{stdio:'ignore'});
  git(dir,'config','user.name','Owned docs fixture');
  git(dir,'config','user.email','owned@example.invalid');
  mkdirSync(join(dir,'docs'),{recursive:true});
  writeFileSync(join(dir,'docs','CHANGELOG.md'),'# Before\n\nAn older document.\n');
  git(dir,'add','docs/CHANGELOG.md');
  git(dir,'commit','-m','Initial docs state');
  const base=git(dir,'rev-parse','HEAD');
  return{dir,base,initial:readFileSync(join(dir,'docs','CHANGELOG.md'),'utf8')};
}
async function fixture(t,opts={}){
  const gitFixture=ownedGit(t),{app,root}=setup(t),b=await baseline(app);
  const artifact=(await execute(app,'deliverable.render',{id:b.deliverable.id})).entity;
  const candidate=(await execute(app,'candidate.freeze',{
    release_id:b.release.id,name:'Owned docs candidate',
    artifact_ids:[artifact.id],destination:'local-docs-review',
    contract:{version:'owned-fixture',required_reviewers:1,require_claims_verified:false}
  })).entity;
  if(opts.review!==false)await execute(app,'candidate.review',{
    id:candidate.id,candidate_sha256:candidate.data.candidate_sha256,
    decision:'approve-editorial',comment:'Owned synthetic docs-review-only'
  });
  const planInput={
    repository_root:gitFixture.dir,github_repository:REPO,base_branch:'main',
    docs_path:'docs/CHANGELOG.md',candidate_id:candidate.id,artifact_id:artifact.id,
    acknowledge_draft_only:true,acknowledge_unverified:true
  };
  const confirmations=plan=>({
    confirm_plan_sha256:plan.plan_sha256,
    confirm_candidate_sha256:plan.candidate_sha256,
    confirm_base_commit_sha:plan.base_commit_sha,
    acknowledge_local_git_write:true
  });
  return{...gitFixture,app,root,b,artifact,candidate,planInput,confirmations};
}
test('R40 private plan binds exact local Git base/tree and frozen Markdown; no side effects',async t=>{
  const x=await fixture(t);
  const before={ref:git(x.dir,'rev-parse','HEAD'),status:git(x.dir,'status','--porcelain'),
    branches:git(x.dir,'branch','--list')};
  const plan=prepareGitDocsBranch(x.app,x.planInput);
  assert.deepEqual(plan,prepareGitDocsBranch(x.app,x.planInput));
  assert.deepEqual(verifyGitDocsPlan(x.app,plan,x.dir),plan);
  assert.equal(plan.base_commit_sha,x.base);
  assert.match(plan.plan_sha256,/^[a-f0-9]{64}$/);
  assert.equal(plan.artifact_sha256,x.artifact.data.sha256);
  assert.equal(plan.external_pr_created,false);
  assert.equal(plan.platform_publish_authority,false);
  assert.equal(plan.technical_state,'UNKNOWN');
  assert.ok(!JSON.stringify(plan).includes(x.dir),'Private repository root path not disclosed by plan');
  assert.equal(git(x.dir,'rev-parse','HEAD'),before.ref);
  assert.equal(git(x.dir,'branch','--list'),before.branches);
  assert.equal(git(x.dir,'status','--porcelain'),before.status);
});

test('R40 apply creates exactly one local docs branch with the exact candidate bytes, preserving checked-out worktree',async t=>{
  const x=await fixture(t);
  const plan=prepareGitDocsBranch(x.app,x.planInput);
  const oldStatus=git(x.dir,'status','--porcelain');
  const mainIndex=join(x.dir,'.git','index');
  const originalIndex=createHash('sha256').update(readFileSync(mainIndex)).digest('hex');
  const result=applyGitDocsBranch(x.app,plan,x.dir,x.confirmations(plan));
  assert.equal(result.state,'LOCAL_BRANCH_READY');
  assert.equal(result.branch,plan.branch);
  assert.equal(result.local_git_write_performed,true);
  assert.equal(result.external_network_access_performed,false);
  assert.equal(result.github_pr_created,false);
  assert.equal(result.published,false);
  assert.equal(result.platform_authority,false);
  assert.equal(git(x.dir,'rev-parse','HEAD'),x.base);
  assert.equal(git(x.dir,'symbolic-ref','--short','HEAD'),'main');
  assert.equal(git(x.dir,'status','--porcelain'),oldStatus);
  assert.equal(createHash('sha256').update(readFileSync(mainIndex)).digest('hex'),originalIndex,
    'A separate GIT_INDEX_FILE must protect the operator current index');
  assert.equal(readFileSync(join(x.dir,'docs','CHANGELOG.md'),'utf8'),x.initial);
  assert.equal(git(x.dir,'rev-list','--parents','-n','1',result.commit_sha),
    result.commit_sha+' '+x.base);
  assert.equal(git(x.dir,'diff-tree','--no-commit-id','--name-only','-r',x.base,result.commit_sha),
    'docs/CHANGELOG.md');
  const expected=x.app.store.readBlob(x.artifact.data.sha256).bytes;
  const observed=execFileSync('git',['-C',x.dir,'show',result.commit_sha+':docs/CHANGELOG.md']);
  assert.deepEqual(observed,expected);
  assert.notEqual(git(x.dir,'rev-parse','HEAD'),result.commit_sha);
});

test('R40 recover-only by exact plan reuses a verified local branch, no duplicate commit',async t=>{
  const x=await fixture(t),plan=prepareGitDocsBranch(x.app,x.planInput);
  const first=applyGitDocsBranch(x.app,plan,x.dir,x.confirmations(plan));
  const again=applyGitDocsBranch(x.app,plan,x.dir,x.confirmations(plan));
  assert.deepEqual({...again,local_git_write_performed:true,recovered:false},first);
  assert.equal(again.recovered,true);
  assert.equal(again.local_git_write_performed,false);
  assert.equal(git(x.dir,'branch','--list',plan.branch).trim().split('\n').length,1);
});

test('R40 rejects altered plan, wrong consent, path traversal, incompatible Git repo or renamed branch before effects',async t=>{
  const x=await fixture(t),plan=prepareGitDocsBranch(x.app,x.planInput);
  assert.throws(()=>verifyGitDocsPlan(x.app,{...plan,docs_path:'docs/WRONG.md'},x.dir),{code:'Conflict'});
  for(const mutation of [
    {confirm_plan_sha256:'0'.repeat(64)},
    {confirm_base_commit_sha:'0'.repeat(40)},
    {confirm_candidate_sha256:'0'.repeat(64)},
    {acknowledge_local_git_write:false}
  ])assert.throws(()=>applyGitDocsBranch(x.app,plan,x.dir,{
    ...x.confirmations(plan),...mutation
  }),{code:'ConsentRequired'});
  for(const docs_path of ['README.md','docs/../SECRET.md','docs/.git/config.md',
    'docs/../.git/hooks.md','docs/WHAT.sh','docs/../../private.md']){
    assert.throws(()=>prepareGitDocsBranch(x.app,{...x.planInput,docs_path}));
  }
  assert.throws(()=>prepareGitDocsBranch(x.app,{...x.planInput,github_repository:'-danger/destination'}));
  assert.throws(()=>prepareGitDocsBranch(x.app,{...x.planInput,acknowledge_draft_only:false}),{code:'ConsentRequired'});
  assert.equal(git(x.dir,'rev-parse','HEAD'),x.base);
  assert.equal(git(x.dir,'branch','--list').trim(),'* main');
});

test('R40 Git base branch advance invalidates the entire saved plan without touching a branch',async t=>{
  const x=await fixture(t),plan=prepareGitDocsBranch(x.app,x.planInput);
  writeFileSync(join(x.dir,'docs','CHANGELOG.md'),'# Updated in main\n');
  git(x.dir,'add','docs/CHANGELOG.md');
  git(x.dir,'commit','-m','Concurrent branch edit');
  assert.throws(()=>applyGitDocsBranch(x.app,plan,x.dir,x.confirmations(plan)),{code:'StaleReference'});
  assert.equal(git(x.dir,'branch','--list',plan.branch),'');
});

test('R40 preexisting colliding local docs branch is never overwritten',async t=>{
  const x=await fixture(t),plan=prepareGitDocsBranch(x.app,x.planInput);
  git(x.dir,'branch',plan.branch,'main');
  assert.throws(()=>applyGitDocsBranch(x.app,plan,x.dir,x.confirmations(plan)),{code:'Conflict'});
  assert.equal(git(x.dir,'rev-parse','refs/heads/'+plan.branch),x.base);
});

test('R40 unreviewed editorial candidate or unacknowledged technical UNKNOWN cannot create Git docs output',async t=>{
  const x=await fixture(t,{review:false});
  assert.throws(()=>prepareGitDocsBranch(x.app,x.planInput),{code:'ConsentRequired'});
  await execute(x.app,'candidate.review',{id:x.candidate.id,
    candidate_sha256:x.candidate.data.candidate_sha256,decision:'approve-editorial',
    comment:'Explicit late review'});
  assert.throws(()=>prepareGitDocsBranch(x.app,{
    ...x.planInput,acknowledge_unverified:false
  }),{code:'ConsentRequired'});
  assert.equal(git(x.dir,'branch','--list').trim(),'* main');
});

test('R40 fail-closed symlink Git entry instead of writing through symlink',async t=>{
  const x=await fixture(t);
  const bytes=Buffer.from('sensitive-file-target');
  const blob=execFileSync('git',['-C',x.dir,'hash-object','-w','--stdin'],{input:bytes,encoding:'utf8'}).trim();
  git(x.dir,'update-index','--add','--cacheinfo','120000',blob,'docs/CHANGELOG.md');
  const tree=git(x.dir,'write-tree');
  const commit=git(x.dir,'commit-tree',tree,'-p',x.base,'-m','Synthetic symlink fixture');
  git(x.dir,'update-ref','refs/heads/main',commit,x.base);
  assert.throws(()=>prepareGitDocsBranch(x.app,x.planInput),{code:'Conflict'});
  assert.equal(git(x.dir,'branch','--list').trim(),'* main');
});

test('R40 human-uncommitted destination edits are protected; other files may be dirty',async t=>{
  const x=await fixture(t);
  writeFileSync(join(x.dir,'README-other.txt'),'An unrelated working tree file');
  // An unrelated untracked file is allowed: the branch uses the pinned base
  // tree and a separate Git index, never checking out or touching that file.
  const plan=prepareGitDocsBranch(x.app,x.planInput);
  assert.equal(plan.base_commit_sha,x.base);
  writeFileSync(join(x.dir,'docs','CHANGELOG.md'),'# Uncommitted human-written docs\n');
  assert.throws(()=>prepareGitDocsBranch(x.app,x.planInput),{code:'Conflict'});
  assert.throws(()=>applyGitDocsBranch(x.app,plan,x.dir,x.confirmations(plan)),{code:'Conflict'});
  assert.equal(readFileSync(join(x.dir,'docs','CHANGELOG.md'),'utf8'),'# Uncommitted human-written docs\n');
  assert.equal(git(x.dir,'branch','--list',plan.branch),'');
});

test('R40 operator CLI writes one private plan and applies only with explicit exact confirmations',async t=>{
  const x=await fixture(t),planFile=join(x.root,'private-git-docs-plan.json');
  const run=args=>spawnSync(process.execPath,['scripts/git-docs-pr.mjs',...args],{
    cwd,encoding:'utf8',timeout:20000
  });
  const planned=run(['plan','--state',x.root,'--repo-root',x.dir,
    '--owner-repo',REPO,'--base','main','--docs-path','docs/CHANGELOG.md',
    '--candidate',x.candidate.id,'--artifact',x.artifact.id,
    '--out',planFile,'--acknowledge-draft-only','--acknowledge-unverified']);
  assert.equal(planned.status,0,planned.stdout+planned.stderr);
  const plan=JSON.parse(readFileSync(planFile,'utf8'));
  assert.equal(plan.base_commit_sha,x.base);
  assert.equal(run(['plan','--state',x.root,'--repo-root',x.dir,
    '--owner-repo',REPO,'--base','main','--docs-path','docs/CHANGELOG.md',
    '--candidate',x.candidate.id,'--artifact',x.artifact.id,
    '--out',planFile,'--acknowledge-draft-only','--acknowledge-unverified']).status!==0,true,
    'A private plan must not be overwritten');
  const confirmation=[
    'apply','--state',x.root,'--repo-root',x.dir,'--plan',planFile,
    '--confirm-plan',plan.plan_sha256,
    '--confirm-candidate',plan.candidate_sha256,
    '--confirm-base',plan.base_commit_sha,'--acknowledge-local-git-write'
  ];
  const executed=run(confirmation);
  assert.equal(executed.status,0,executed.stdout+executed.stderr);
  const result=JSON.parse(executed.stdout);
  assert.equal(result.github_pr_created,false);
  assert.equal(result.local_git_write_performed,true);
  const repeated=run(confirmation);
  assert.equal(repeated.status,0,repeated.stdout+repeated.stderr);
  assert.equal(JSON.parse(repeated.stdout).recovered,true);
  assert.equal(git(x.dir,'symbolic-ref','--short','HEAD'),'main');
});


test('R40 a new docs Markdown path stages exactly one new file, and does not execute Git hooks',async t=>{
  const x=await fixture(t);
  const hook=join(x.dir,'.git','hooks','pre-commit');
  const marker=join(x.dir,'HOOK_WAS_RUN');
  writeFileSync(hook,'#!/bin/sh\nprintf insecure > HOOK_WAS_RUN\n',{mode:0o755});
  const input={...x.planInput,docs_path:'docs/new-release.md'};
  const plan=prepareGitDocsBranch(x.app,input);
  assert.equal(plan.previous_docs_sha256,null);
  const applied=applyGitDocsBranch(x.app,plan,x.dir,x.confirmations(plan));
  assert.equal(applied.local_git_write_performed,true);
  assert.equal(git(x.dir,'diff-tree','--no-commit-id','--name-status','-r',x.base,applied.commit_sha),
    'A\tdocs/new-release.md');
  assert.equal(existsSync(marker),false,'Git hooks were never executed');
  assert.equal(existsSync(join(x.dir,'docs','new-release.md')),false,'No checkout occurred');
});
