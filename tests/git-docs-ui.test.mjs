// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {createGitDocsController} from '../web/git-docs-ui.mjs';

const p={
 schema_version:'launchwright-git-docs-branch-intent/1',
 plan_sha256:'a'.repeat(64),candidate_sha256:'b'.repeat(64),
 base_commit_sha:'c'.repeat(40),artifact_sha256:'d'.repeat(64),
 branch:'launchwright/docs-'+'a'.repeat(20),
 github_repository:'owned-org/test',docs_path:'docs/CHANGELOG.md',technical_state:'UNKNOWN'
};
const input={
 repository_root:'/safe/owned/repo',github_repository:'owned-org/test',
 base_branch:'main',docs_path:'docs/CHANGELOG.md',candidate_id:'ca',artifact_id:'ar',
 acknowledge_draft_only:true,acknowledge_unverified:true
};
const fake=()=>{
 const calls=[];
 const api={
  planLocalGitDocs:async d=>{calls.push(['plan',d]);return{plan:p};},
  inspectLocalGitDocs:async(root,plan)=>{calls.push(['inspect',root,plan]);return{
    state:'LOCAL_BRANCH_READY',branch:plan.branch,commit_sha:'e'.repeat(40),
    source_artifact_sha256:plan.artifact_sha256
  };},
  applyLocalGitDocs:async(root,plan,confirmations)=>{calls.push(['apply',root,plan,confirmations]);return{
    state:'LOCAL_BRANCH_READY',commit_sha:'e'.repeat(40),local_git_write_performed:true
  };}
 };
 return{api,calls};
};
test('R68 UI only prepares through explicit action, never auto-submits or saves paths in storage',async()=>{
 const x=fake(),u=createGitDocsController(x.api);
 assert.equal(u.plan,null);assert.deepEqual(x.calls,[]);
 await assert.rejects(u.prepare({...input,repository_root:'relative'}));
 await assert.rejects(u.prepare({...input,acknowledge_draft_only:false}));
 assert.deepEqual(x.calls,[]);
 const prepared=await u.prepare(input);
 assert.equal(prepared.plan_sha256,p.plan_sha256);
 assert.equal(x.calls.length,1);
 assert.equal(x.calls[0][0],'plan');
 const selection=[{id:'ca',data:{name:'Owned',manifest:{artifact_ids:['ar']}}}];
 const html=u.render(selection,[{id:'ar',data:{name:'Markdown'}}]);
 assert.match(html,/Prepare reviewed branch/);
 assert.match(html,/UNKNOWN/);
 assert.match(html,/docs\/CHANGELOG.md/);
 assert.doesNotMatch(html,/\/safe\/owned\/repo/);
 assert.equal(x.calls.length,1);
 assert.equal(u.downloadPlan(),JSON.stringify(p,null,2)+'\n');
});
test('R68 UI confirmations, inspect-only recovery, and restored original plan',async()=>{
 const x=fake(),u=createGitDocsController(x.api);
 await assert.rejects(u.apply({acknowledge_local_git_write:true}));
 await u.prepare(input);
 await assert.rejects(u.apply({acknowledge_local_git_write:false}));
 assert.equal(x.calls.filter(c=>c[0]==='apply').length,0);
 await u.inspect();
 assert.equal(x.calls.at(-1)[0],'inspect');
 await u.apply({
   acknowledge_local_git_write:true,
   confirm_plan_sha256:p.plan_sha256,
   confirm_candidate_sha256:p.candidate_sha256,
   confirm_base_commit_sha:p.base_commit_sha
 });
 assert.equal(x.calls.filter(c=>c[0]==='apply').length,1);
 assert.equal(x.calls.filter(c=>c[0]==='inspect').length,2);
 assert.equal(u.status.state,'LOCAL_BRANCH_READY');
 u.clear();
 assert.equal(u.plan,null);assert.equal(u.repoRoot,'');
 await u.restore(p,input.repository_root);
 assert.equal(u.plan.plan_sha256,p.plan_sha256);
 assert.equal(x.calls.at(-1)[0],'inspect');
});
test('R68 UI HTML-escapes untrusted candidate and Git text, not an executable script',async()=>{
 const x=fake(),u=createGitDocsController(x.api);
 await u.prepare(input);
 const html=u.render([{id:'ca',data:{name:'<script>unsafe</script>',
   manifest:{artifact_ids:['ar']}}}],[{id:'ar',data:{name:'any'}}]);
 assert.ok(!html.includes('<script>'));
 assert.ok(html.includes('docs-git-hash'));
 assert.ok(!html.includes(input.repository_root));
 await assert.rejects(u.restore({...p,plan_sha256:'bad'},input.repository_root));
});
