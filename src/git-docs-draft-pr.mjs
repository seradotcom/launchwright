// SPDX-License-Identifier: AGPL-3.0-only
// R41: operator-managed GitHub DRAFT PR for an already manually pushed exact
// local Git docs branch. Never pushes, merges, publishes, alters remote branch,
// executes customer code or grants Platform/cross-tenant authority.
import { spawnSync } from 'node:child_process';
import { NativeError, requireCondition as ensure, validateValue } from '@semwright/native-sdk';
import { digest } from './base.mjs';
import { inspectGitDocsBranch } from './git-docs-pr.mjs';

export const GIT_DOCS_DRAFT_PR_SCHEMA='launchwright-git-docs-draft-pr-intent/1';
const sha40=value=>typeof value==='string'&&/^[0-9a-f]{40}$/u.test(value);
const sha64=value=>typeof value==='string'&&/^[0-9a-f]{64}$/u.test(value);
function oneLine(value,name,max=140){
  ensure(typeof value==='string'&&value.length>0&&
    Buffer.byteLength(value,'utf8')<=max&&
    !/[\u0000-\u001f\u007f]/u.test(value),
    name+' must be a bounded single-line value');
  return value;
}
function repoName(value){
  oneLine(value,'GitHub repository');
  ensure(/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/u.test(value)&&
    !value.endsWith('.')&&!value.includes('..'),
    'GitHub repository must be exact OWNER/REPO');
  return value;
}
function editorialNote(value){
  ensure(typeof value==='string'&&Buffer.byteLength(value,'utf8')<=1200&&
    !/[\u0000-\u0008\u000b-\u001f\u007f]/u.test(value),
    'Editorial note is too large or has control characters');
  return value;
}
const expectedBody=intent=>[
  'Review this Launchwright-owned draft documentation change. It is **not yet published**.',
  '',
  'Document: '+intent.docs_path,
  'Frozen candidate SHA-256: '+intent.candidate_sha256,
  'Git docs plan SHA-256: '+intent.branch_plan_sha256,
  'Exact Markdown artifact SHA-256: '+intent.artifact_sha256,
  'Local/remote docs branch commit: '+intent.local_branch_commit_sha,
  'Original base commit: '+intent.base_commit_sha,
  'Technical state: '+intent.technical_state+' (not upgraded by this PR)',
  '',
  'Operator review note:',
  intent.editorial_note,
  '',
  'Launchwright intent: '+intent.intent_sha256,
  '',
  'This PR is DRAFT. GitHub merge, approval, deployment, Site activation and',
  'canonical Semwright Platform Publish require separate authorized actions.'
].join('\n');
export function prepareGitDocsDraftPR(app,plan,root,{
  title,editorial_note='',acknowledge_draft_only=false
}={}){
  ensure(acknowledge_draft_only===true,
    'Operator must acknowledge a GitHub DRAFT PR is not publication','ConsentRequired');
  oneLine(title,'GitHub DRAFT PR title',120);
  ensure(!title.startsWith('-'),'GitHub DRAFT PR title cannot start with a flag prefix');
  editorialNote(editorial_note);
  const branch=inspectGitDocsBranch(app,plan,root);
  repoName(plan.github_repository);
  const core={
    schema_version:GIT_DOCS_DRAFT_PR_SCHEMA,
    repository:plan.github_repository,
    base_branch:plan.base_branch,
    base_commit_sha:plan.base_commit_sha,
    head_branch:plan.branch,
    local_branch_commit_sha:branch.commit_sha,
    branch_plan_sha256:plan.plan_sha256,
    candidate_sha256:plan.candidate_sha256,
    artifact_sha256:plan.artifact_sha256,
    docs_path:plan.docs_path,
    technical_state:plan.technical_state==='PASS'?'PASS':'UNKNOWN',
    title,editorial_note,
    draft_only:true,
    external_branch_push_performed:false,
    github_pr_created:false,
    publication_authority:false,
    platform_authority:false,
    customer_acceptance:false
  };
  const intent_sha256=digest('git-docs-draft-pr',core);
  const intent={...core,intent_sha256};
  ensure(Buffer.byteLength(expectedBody(intent),'utf8')<=4096,
    'GitHub DRAFT PR body exceeds bounded source metadata budget');
  return intent;
}
export function verifyGitDocsDraftPR(app,plan,root,intent){
  validateValue(intent);
  ensure(intent&&typeof intent==='object'&&!Array.isArray(intent),
    'Git docs draft intent must be an object');
  const {intent_sha256,...core}=intent;
  ensure(sha64(intent_sha256)&&digest('git-docs-draft-pr',core)===intent_sha256,
    'Git docs PR intent body/metadata was modified','Conflict');
  const expected=prepareGitDocsDraftPR(app,plan,root,{
    title:core.title,editorial_note:core.editorial_note,
    acknowledge_draft_only:core.draft_only
  });
  ensure(JSON.stringify(expected)===JSON.stringify(intent),
    'Git docs PR intent is stale, replaced or has unapproved source bytes',
    'StaleReference');
  return intent;
}
const readName=(value,kind)=>{
  ensure(typeof value==='string'&&value.length>0&&value.length<=140,
    'Invalid '+kind+' GitHub ref identity','Conflict');
  return value;
};
function exactDraft(pr,intent){
  let urlMatches=false;
  if(typeof pr?.html_url==='string'){
    try{
      const url=new URL(pr.html_url);
      urlMatches=url.origin==='https://github.com'&&
        url.pathname==='/'+intent.repository+'/pull/'+pr.number&&
        !url.search&&!url.hash;
    }catch{}
  }
  ensure(pr&&typeof pr==='object'&&urlMatches&&
    Number.isSafeInteger(pr.number)&&pr.number>0 &&
    pr.draft===true&&pr.state==='open'&&
    pr.title===intent.title&&pr.body===expectedBody(intent)&&
    readName(pr.head?.ref,'head')===intent.head_branch&&
    readName(pr.base?.ref,'base')===intent.base_branch&&
    pr.head?.sha===intent.local_branch_commit_sha&&
    pr.base?.sha===intent.base_commit_sha&&
    pr.head?.repo?.full_name===intent.repository&&
    pr.base?.repo?.full_name===intent.repository,
    'Remote GitHub PR is not the exact approved DRAFT, or was changed since preparation',
    'Conflict');
  return pr;
}
export async function sendGitDocsDraftPR(app,plan,root,intent,remote,{
  confirm_repository,confirm_branch_plan_sha256,confirm_local_commit_sha,
  acknowledge_first_send=false,recover_only=false
}={}){
  verifyGitDocsDraftPR(app,plan,root,intent);
  ensure(confirm_repository===intent.repository&&
    confirm_branch_plan_sha256===intent.branch_plan_sha256 &&
    confirm_local_commit_sha===intent.local_branch_commit_sha,
    'Operator must separately confirm exact repo, reviewed branch plan and commit',
    'ConsentRequired');
  for(const action of ['getBaseSha','getBranchSha','getOpenPR','createDraftPR'])
    ensure(remote&&typeof remote[action]==='function',
      'GitHub draft transport is missing required bounded operation');
  const base=await remote.getBaseSha(intent.repository,intent.base_branch);
  ensure(base===intent.base_commit_sha,
    'GitHub base branch has advanced; re-review against the current source','StaleReference');
  const head=await remote.getBranchSha(intent.repository,intent.head_branch);
  ensure(head===intent.local_branch_commit_sha,
    'GitHub remote branch is absent or does not match the exact local review commit. Push it separately with owner consent.',
    'StaleReference');
  let pr=await remote.getOpenPR(intent.repository,intent.head_branch,intent.base_branch);
  let created=false;
  if(!pr){
    ensure(recover_only!==true,
      'There is no matching remote draft PR. Recover-only never creates one.','NotFound');
    ensure(acknowledge_first_send===true,
      'The operator must explicitly authorize creating this remote GitHub DRAFT PR',
      'ConsentRequired');
    try{
      await remote.createDraftPR(intent.repository,{
        title:intent.title,body:expectedBody(intent),
        head:intent.head_branch,base:intent.base_branch,draft:true
      });
      created=true;
    }catch{
      throw new NativeError('Unavailable',
        'Remote PR creation outcome unknown; use recover-only to inspect the original exact intent before any retry',
        false);
    }
    pr=await remote.getOpenPR(intent.repository,intent.head_branch,intent.base_branch);
  }
  exactDraft(pr,intent);
  // After potential external mutation, repeat independent, bounded remote read
  // to reject a moved head/base and prove the DRAFT is still owned.
  ensure(await remote.getBaseSha(intent.repository,intent.base_branch)===intent.base_commit_sha &&
    await remote.getBranchSha(intent.repository,intent.head_branch)===intent.local_branch_commit_sha,
    'GitHub branch changed during review request','StaleReference');
  verifyGitDocsDraftPR(app,plan,root,intent);
  return{
    schema_version:'launchwright-git-docs-draft-pr-receipt/1',
    intent_sha256:intent.intent_sha256,
    repository:intent.repository,
    base_commit_sha:intent.base_commit_sha,
    head_commit_sha:intent.local_branch_commit_sha,
    pr_number:pr.number,
    pr_url:pr.html_url,
    state:'REMOTE_DRAFT_CREATED',
    recovered:!created,
    remote_pr_creation_performed:created,
    external_branch_push_performed:false,
    approved_merge_performed:false,published:false,
    platform_authority:false,customer_acceptance:false
  };
}
function gh(args,{allow404=false,input=null}={}){
  ensure(!process.env.GH_HOST||process.env.GH_HOST==='github.com',
    'GitHub drafts are limited to github.com','PolicyDenied');
  const result=spawnSync('gh',args,{
    input,encoding:'utf8',timeout:30000,maxBuffer:512*1024,
    env:{...process.env,GH_PROMPT_DISABLED:'1',GIT_TERMINAL_PROMPT:'0'}
  });
  if(result.error||result.status!==0){
    if(allow404&&/(?:HTTP 404|404 Not Found|404 \\\(Not Found\\\))/u.test(result.stderr??''))
      return null;
    throw new NativeError('Unavailable',
      'GitHub CLI request did not confirm an exact outcome; use recover-only',false);
  }
  try{return JSON.parse(result.stdout);}catch{
    throw new NativeError('ProtocolMismatch','GitHub CLI reply was not valid JSON');
  }
}
export function createGithubDocsTransport(run=gh){
  return{
    async getBaseSha(repo,base){
      repoName(repo);oneLine(base,'Base branch',88);
      const r=run(['api','repos/'+repo+'/branches/'+base],{allow404:true});
      return r?.commit?.sha??null;
    },
    async getBranchSha(repo,head){
      repoName(repo);oneLine(head,'Head branch',100);
      const r=run(['api','repos/'+repo+'/git/ref/heads/'+head],{allow404:true});
      return r?.object?.sha??null;
    },
    async getOpenPR(repo,head,base){
      repoName(repo);oneLine(head,'Head branch',100);oneLine(base,'Base branch',88);
      const owner=repo.split('/')[0];
      const params=new URLSearchParams({state:'all',head:owner+':'+head,base,per_page:'10'});
      const result=run(['api','repos/'+repo+'/pulls?'+params.toString()]);
      ensure(Array.isArray(result)&&result.length<=10,'GitHub PR discovery was unbounded','ResourceExhausted');
      ensure(result.length<=1,'Multiple historical GitHub PRs match this source branch; manual operator reconciliation required','Conflict');
      return result[0]??null;
    },
    async createDraftPR(repo,payload){
      repoName(repo);
      ensure(payload?.draft===true,'Only DRAFT PR creation is permitted','PermissionDenied');
      return run(['api','--method','POST','repos/'+repo+'/pulls','--input','-'],
        {input:JSON.stringify(payload)});
    }
  };
}
