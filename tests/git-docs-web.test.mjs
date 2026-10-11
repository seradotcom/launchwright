// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {setup} from './helpers.mjs';
import {createR68Fixture,ownedGit} from './git-docs-web-fixture.mjs';
import {createAppServer} from '../src/server.mjs';
import {LaunchwrightClient} from '../client/index.mjs';
import {execute} from '../src/application.mjs';

const OWNER='r68-owned-synthetic-local-session-token';
const CONSUMER='r68-owned-synthetic-consumer-token';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const confirmations=plan=>({
  confirm_plan_sha256:plan.plan_sha256,
  confirm_candidate_sha256:plan.candidate_sha256,
  confirm_base_commit_sha:plan.base_commit_sha,
  acknowledge_local_git_write:true
});
async function fixture(t){
  const {app,root}=setup(t);
  const f=await createR68Fixture(app);
  t.after(()=>f.cleanup());
  const srv=createAppServer(app,{port:0,token:OWNER,bearerPrincipals:[
    {principal:'synthetic-external-consumer',token:CONSUMER,scopes:['consume']}
  ]});
  const origin=await srv.listen();
  t.after(()=>srv.close());
  const client=new LaunchwrightClient({baseUrl:origin,token:OWNER});
  return{...f,app,root,origin,client,srv};
}
const post=(f,route,payload,token=OWNER,headers={})=>fetch(
  f.origin+'/api/v1/local-git-docs/'+route,{method:'POST',headers:{
    'Content-Type':'application/json',Authorization:'Bearer '+token,...headers
  },body:JSON.stringify(payload)}
);

test('R68 Native-backed R40 plan is deterministic, read-only and returns no private checkout path',async t=>{
  const f=await fixture(t);
  const before=ownedGit(f.repository_root,'status','--porcelain');
  const refs=ownedGit(f.repository_root,'branch','--list');
  const records=f.app.store.all().length;
  const result=await f.client.planLocalGitDocs(f.planInput);
  const again=await f.client.planLocalGitDocs(f.planInput);
  assert.deepEqual(result,again);
  const p=result.plan;
  assert.equal(result.workspace_mutated,false);
  assert.equal(result.local_git_write_performed,false);
  assert.equal(result.github_pr_created,false);
  assert.equal(p.technical_state,'UNKNOWN');
  assert.equal(p.base_commit_sha,f.base);
  assert.equal(p.candidate_sha256,f.candidate.data.candidate_sha256);
  assert.equal(p.artifact_sha256,f.artifact.data.sha256);
  assert.match(p.plan_sha256,/^[0-9a-f]{64}$/u);
  assert.ok(!JSON.stringify(result).includes(f.repository_root));
  assert.equal(ownedGit(f.repository_root,'status','--porcelain'),before);
  assert.equal(ownedGit(f.repository_root,'branch','--list'),refs);
  assert.equal(f.app.store.all().length,records);
  assert.equal((await f.client.inspectLocalGitDocs(f.repository_root,p)).state,'NOT_APPLIED');
});

test('R68 creates exact one-file reviewed branch without checking it out, touching user index or running hooks',async t=>{
  const f=await fixture(t);
  const marker=join(f.repository_root,'hook-run-marker');
  // Would be unsafe to invoke if this were a normal git commit; Git plumbing
  // does not run hooks, regardless of operator repo hooks.
  writeFileSync(join(f.repository_root,'.git','hooks','post-commit'),
    '#!/bin/sh\necho unsafe > '+marker+'\n',{mode:0o755});
  const plan=(await f.client.planLocalGitDocs(f.planInput)).plan;
  const index=join(f.repository_root,'.git','index');
  const originalHash=hash(readFileSync(index));
  const status=ownedGit(f.repository_root,'status','--porcelain');
  const result=await f.client.applyLocalGitDocs(f.repository_root,plan,confirmations(plan));
  assert.equal(result.state,'LOCAL_BRANCH_READY');
  assert.equal(result.recovered,false);
  assert.equal(result.local_git_write_performed,true);
  assert.equal(result.github_pr_created,false);
  assert.equal(result.manually_pushed,false);
  assert.equal(result.published,false);
  assert.equal(result.platform_authority,false);
  const readback=await f.client.inspectLocalGitDocs(f.repository_root,plan);
  assert.equal(readback.state,'LOCAL_BRANCH_READY');
  assert.equal(readback.commit_sha,result.commit_sha);
  assert.equal(readback.plan_sha256,plan.plan_sha256);
  assert.equal(readback.source_artifact_sha256,f.artifact.data.sha256);
  assert.equal(ownedGit(f.repository_root,'rev-parse','HEAD'),f.base);
  assert.equal(ownedGit(f.repository_root,'status','--porcelain'),status);
  assert.equal(hash(readFileSync(index)),originalHash);
  assert.equal(existsSync(marker),false);
  assert.equal(ownedGit(f.repository_root,'rev-parse',plan.branch),result.commit_sha);
  const expected=f.app.store.readBlob(plan.artifact_sha256).bytes;
  const actual=Buffer.from(ownedGit(f.repository_root,'show',plan.branch+':'+plan.docs_path)+'\n');
  assert.deepEqual(actual,expected);
  const delta=ownedGit(f.repository_root,'diff','--name-only',f.base,result.commit_sha);
  assert.equal(delta,plan.docs_path);
  const recovered=await f.client.applyLocalGitDocs(f.repository_root,plan,confirmations(plan));
  assert.equal(recovered.recovered,true);
  assert.equal(recovered.local_git_write_performed,false);
  assert.equal(recovered.commit_sha,result.commit_sha);
});

test('R68 HTTP owner restriction denies consumers, unauthenticated, cross-origin and unbounded/malformed input',async t=>{
  const f=await fixture(t);
  for(const route of ['plan','apply','inspect']){
    for(const token of [CONSUMER,'not-the-owner']){
      const res=await post(f,route,{},token);
      assert.equal(res.status,403,route);
    }
    const res=await post(f,route,{},OWNER,{Origin:'https://evil.example.invalid'});
    assert.equal(res.status,403);
  }
  assert.equal((await post(f,'plan',{...f.planInput,script:'npm run unsafe'})).status,400);
  assert.equal((await post(f,'plan',{...f.planInput,acknowledge_draft_only:false})).status,403);
  const p=(await f.client.planLocalGitDocs(f.planInput)).plan;
  assert.equal((await post(f,'apply',{repository_root:f.repository_root,plan:p,...confirmations(p),
    arbitrary_shell:'git push'})).status,400);
  assert.equal((await post(f,'inspect',{repository_root:f.repository_root,plan:p,
    token:'credential'})).status,400);
  assert.equal(ownedGit(f.repository_root,'branch','--list'),'* main');
});

test('R68 all three identities and explicit Git-write checkbox required before lock or branch',async t=>{
  const f=await fixture(t);
  const p=(await f.client.planLocalGitDocs(f.planInput)).plan;
  const c=confirmations(p);
  for(const patch of [
    {confirm_plan_sha256:'a'.repeat(64)},
    {confirm_candidate_sha256:'b'.repeat(64)},
    {confirm_base_commit_sha:'c'.repeat(40)},
    {acknowledge_local_git_write:false}
  ]){
    const reply=await post(f,'apply',{repository_root:f.repository_root,plan:p,...c,...patch});
    assert.equal(reply.status,403);
  }
  assert.equal(existsSync(join(f.root,'.git-docs-web-apply.lock')),false);
  assert.equal(ownedGit(f.repository_root,'branch','--list'),'* main');
});

test('R68 recover-only GET equivalent rejects tampered saved plan, unexpected branch and source drift',async t=>{
  const f=await fixture(t);
  const p=(await f.client.planLocalGitDocs(f.planInput)).plan;
  const invalid=await post(f,'inspect',{repository_root:f.repository_root,
    plan:{...p,docs_path:'docs/UNREVIEWED.md'}});
  assert.equal(invalid.status,409);
  // A branch already occupied by unrelated history cannot be replaced.
  ownedGit(f.repository_root,'branch',p.branch,f.base);
  const conflict=await post(f,'apply',{repository_root:f.repository_root,
    plan:p,...confirmations(p)});
  assert.equal(conflict.status,409);
  ownedGit(f.repository_root,'branch','-D',p.branch);
  const d=f.b.deliverable;
  await execute(f.app,'entity.update',{
    id:d.id,expected:d.version,data:{...d.data,content:'Human changed release note'}
  });
  const stale=await post(f,'apply',{repository_root:f.repository_root,
    plan:p,...confirmations(p)});
  assert.equal(stale.status,403);
  assert.equal((await stale.json()).error.code,'ConsentRequired');
  assert.equal(existsSync(join(f.root,'.git-docs-web-apply.lock')),false);
});

test('R68 real Git dirty docs path, held lock and base drift all fail closed without an auto-rebase',async t=>{
  const f=await fixture(t);
  const p=(await f.client.planLocalGitDocs(f.planInput)).plan;
  const lock=join(f.root,'.git-docs-web-apply.lock');
  writeFileSync(lock,'Another operator has this lock',{mode:0o600});
  assert.equal((await post(f,'apply',{repository_root:f.repository_root,
    plan:p,...confirmations(p)})).status,409);
  assert.equal(existsSync(lock),true);
  const {unlinkSync}=await import('node:fs');unlinkSync(lock);
  writeFileSync(join(f.repository_root,'docs','RELEASE_NOTES.md'),'Uncommitted human edits\n');
  assert.equal((await post(f,'apply',{repository_root:f.repository_root,
    plan:p,...confirmations(p)})).status,409);
  ownedGit(f.repository_root,'checkout','--','docs/RELEASE_NOTES.md');
  writeFileSync(join(f.repository_root,'NEW.md'),'New base\n');
  ownedGit(f.repository_root,'add','NEW.md');
  ownedGit(f.repository_root,'commit','-m','Human changes base');
  assert.equal((await post(f,'inspect',{repository_root:f.repository_root,plan:p})).status,409);
  assert.equal(ownedGit(f.repository_root,'branch','--list'),'* main');
});

test('R68 simulated lost HTTP response recovers by readback only, never retries the remote mutation',async t=>{
  const f=await fixture(t);
  const p=(await f.client.planLocalGitDocs(f.planInput)).plan;
  let sends=0;
  const interrupted=new LaunchwrightClient({baseUrl:f.origin,token:OWNER,
    fetchImpl:async(url,options)=>{
      const res=await fetch(url,options);
      if(url.endsWith('/local-git-docs/apply')){sends++;throw Error('Reply interrupted');}
      return res;
    }
  });
  await assert.rejects(interrupted.applyLocalGitDocs(
    f.repository_root,p,confirmations(p)),{code:'Unavailable'});
  assert.equal(sends,1);
  const recovered=await f.client.inspectLocalGitDocs(f.repository_root,p);
  assert.equal(recovered.state,'LOCAL_BRANCH_READY');
  assert.equal(ownedGit(f.repository_root,'rev-parse',p.branch),recovered.commit_sha);
  assert.equal(sends,1);
  assert.equal((await f.client.inspectLocalGitDocs(f.repository_root,p)).commit_sha,recovered.commit_sha);
});
