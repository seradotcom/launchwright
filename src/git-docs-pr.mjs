// SPDX-License-Identifier: AGPL-3.0-only
// R40: exact Markdown candidate → owner Git docs-review branch using Git
// *plumbing* only. No worktree checkout, repo hooks, arbitrary scripts,
// network, GitHub PR, external publication or Platform authority.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, realpathSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { TextDecoder } from 'node:util';
import { NativeError, requireCondition as ensure, validateValue } from '@semwright/native-sdk';
import { digest } from './base.mjs';

export const GIT_DOCS_PR_SCHEMA='launchwright-git-docs-branch-intent/1';
const BUDGET=128*1024;
const sha40=v=>typeof v==='string'&&/^[0-9a-f]{40}$/u.test(v);
const sha64=v=>typeof v==='string'&&/^[0-9a-f]{64}$/u.test(v);
const sha256=v=>createHash('sha256').update(v).digest('hex');
const decode=v=>new TextDecoder('utf-8',{fatal:true}).decode(v);
function single(v,max,name){
  ensure(typeof v==='string'&&v.length>0&&Buffer.byteLength(v)<=max&&
    !/[\0-\x1f\x7f]/u.test(v),name+' must be bounded single-line text');
  return v;
}
function branchName(value){
  single(value,88,'Base branch');
  ensure(/^[a-z][a-z0-9._/-]*$/u.test(value)&&
    !value.split('/').some(x=>x===''||x==='.'||x==='..'||x.endsWith('.lock'))&&
    !value.includes('..')&&!value.endsWith('.'),
    'Git base branch contains forbidden components');
  return value;
}
function docsPath(value){
  single(value,192,'Docs path');
  ensure(/^docs\/[A-Za-z0-9_.\/-]+\.md$/u.test(value) &&
    !value.split('/').slice(1).some(v=>
      v===''||v.startsWith('.')||v.endsWith('.lock')||
      /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:[.]|$)/iu.test(v))&&
    !value.includes('..')&&!value.includes('//'),
    'Git docs path must be a safe tracked docs/*.md location','InvalidArgument');
  return value;
}
function repository(value){
  single(value,128,'GitHub repository');
  ensure(/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/u.test(value)&&
    !value.includes('..')&&!value.endsWith('.'),
    'Expected exact GitHub OWNER/REPO');
  return value;
}
function git(root,args,{env={},input=null,allowMissing=false,limit=256*1024}={}){
  const result=spawnSync('git',[
    '-C',root,'-c',process.platform==='win32'?'core.hooksPath=NUL':'core.hooksPath=/dev/null',
    '-c','core.fsmonitor=false','-c','core.splitIndex=false',
    '-c','commit.gpgsign=false',
    '-c','diff.external=','-c','core.quotePath=false',...args
  ],{
    input,encoding:null,timeout:12000,maxBuffer:limit+65536,
    env:{...process.env,GIT_TERMINAL_PROMPT:'0',GIT_OPTIONAL_LOCKS:'0',
      GIT_CONFIG_NOSYSTEM:'1',
      GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':'/dev/null',
      GIT_EXTERNAL_DIFF:'',GIT_LFS_SKIP_SMUDGE:'1',...env}
  });
  if(result.error || result.stdout?.length>limit || result.stderr?.length>limit)
    throw new NativeError('Unavailable','Git docs operation exceeded its bounded local process budget');
  if(result.status!==0){
    if(allowMissing&&result.status===1)return null;
    throw new NativeError('Unavailable','Scoped Git metadata operation failed');
  }
  return result.stdout;
}
const gitString=(root,args,{allowMissing=false,max=256,env={}}={})=>{
  const bytes=git(root,args,{allowMissing,limit:max,env});
  if(bytes===null)return null;
  const value=decode(bytes).trim();
  ensure(value.length>0&&value.length<=max,'Git identity is missing or outside budget','ProtocolMismatch');
  return value;
};
function rootCheck(path){
  ensure(typeof path==='string'&&isAbsolute(path)&&path.length<=2048,
    'An absolute local repository root must be selected');
  const real=realpathSync(path);
  ensure(statSync(real).isDirectory(),'Git source is not a directory');
  ensure(gitString(real,['rev-parse','--is-inside-work-tree'])==='true'&&
    gitString(real,['rev-parse','--is-bare-repository'])==='false',
    'Docs Git source must be a normal non-bare working tree');
  const prefix=git(real,['rev-parse','--show-prefix'],{limit:1024});
  ensure(decode(prefix).trim().length===0,'Docs Git path must name the exact working-tree root','InvalidArgument');
  return real;
}
function baseContext(root,baseBranch,path){
  // A normal local docs review may not ignore an uncommitted human edit
  // at the exact destination. This is deliberately narrower than refusing
  // unrelated changes elsewhere in a real customer project.
  const workingChange=git(root,['status','--porcelain','-z','--untracked-files=normal','--',path],{limit:8192});
  ensure(workingChange.length===0,
    'The destination docs file has unstaged/staged/untracked local edits; review them before drafting a Git branch',
    'Conflict');
  const base=gitString(root,['rev-parse','--verify','refs/heads/'+baseBranch+'^{commit}'],{max:80});
  ensure(sha40(base),'Docs branch target must be a pinned full commit SHA');
  const tree=gitString(root,['rev-parse',base+'^{tree}'],{max:80});
  ensure(sha40(tree),'Docs target tree is not stable');
  // inspect Git object mode, not checked-out files. A symlink in Git cannot be
  // adopted as an editable Markdown file, even if the local OS resolves it.
  const parentNames=path.split('/');parentNames.pop();
  for(let i=1;i<=parentNames.length;i++){
    const part=parentNames.slice(0,i).join('/');
    const item=git(root,['ls-tree',base,'--',part],{limit:4096});
    if(item.length){
      const mode=decode(item).split(' ')[0];
      ensure(mode==='040000' || mode==='040000\n' || mode==='40000',
        'A Git docs parent is not an ordinary tree directory','Conflict');
    }
  }
  const entry=git(root,['ls-tree',base,'--',path],{limit:4096});
  let previous=null;
  if(entry.length){
    const meta=decode(entry).trim();
    ensure(/^100644 blob [a-f0-9]{40}\t/u.test(meta),
      'Existing Git docs path is not a normal file; symlinks are forbidden','Conflict');
    const bytes=git(root,['cat-file','blob',base+':'+path],{limit:BUDGET});
    ensure(bytes.length<=BUDGET,'Original docs content exceeds budget','ResourceExhausted');
    previous=sha256(bytes);
  }
  return{base,tree,previous};
}
function candidateBytes(app,candidateId,artifactId,acknowledgeUnverified){
  const candidate=app.get(candidateId,'candidate');
  const artifact=app.get(artifactId,'artifact');
  const items=candidate.data.manifest.artifacts??[];
  const frozen=items.find(x=>x.id===artifactId);
  ensure(candidate.data.manifest.artifact_ids.includes(artifactId)&&
    frozen?.sha256===artifact.data.sha256 &&
    frozen?.bytes===artifact.data.size_bytes &&
    frozen?.mime?.split(';')[0].trim().toLowerCase()==='text/markdown',
    'Only exact frozen Markdown candidate artifacts may become Git docs branches',
    'PermissionDenied');
  const checked=app.inspectCandidate(candidate);
  ensure(checked.fresh&&checked.private_draft_allowed&&
    checked.editorial_review.state==='APPROVED_EDITORIAL',
    'Git docs branch requires fresh exact candidate and approved editorial review',
    'ConsentRequired');
  if(checked.technical_state!=='PASS')ensure(acknowledgeUnverified===true,
    'Unknown technical proof must be explicitly acknowledged','ConsentRequired');
  const bytes=app.store.readBlob(frozen.sha256).bytes;
  ensure(bytes.length>0&&bytes.length<=BUDGET&&
    bytes.length===frozen.bytes&&sha256(bytes)===frozen.sha256,
    'Git docs source bytes differ from the frozen artifact or exceed budget','Conflict');
  let text;
  try{text=decode(bytes);}catch{
    throw new NativeError('InvalidArgument','Git docs output must be UTF-8 Markdown');
  }
  ensure(!text.includes('\0'),'Git docs Markdown contains forbidden NUL');
  return{candidate,artifact,bytes,technical_state:checked.technical_state};
}
export function prepareGitDocsBranch(app,{
  repository_root,github_repository,base_branch,docs_path,
  candidate_id,artifact_id,acknowledge_draft_only,acknowledge_unverified
}={}){
  repository(github_repository);branchName(base_branch);docsPath(docs_path);
  ensure(acknowledge_draft_only===true,
    'Explicitly acknowledge this only prepares a local Git docs branch, not a remote PR or publication',
    'ConsentRequired');
  const {candidate,bytes,technical_state}=candidateBytes(app,candidate_id,artifact_id,acknowledge_unverified);
  const real=rootCheck(repository_root);
  const gitContext=baseContext(real,base_branch,docs_path);
  const core={
    schema_version:GIT_DOCS_PR_SCHEMA,
    github_repository,base_branch,base_commit_sha:gitContext.base,
    base_tree_sha:gitContext.tree,
    docs_path,previous_docs_sha256:gitContext.previous,
    repository_root_sha256:sha256(Buffer.from(real)),
    candidate_id,candidate_sha256:candidate.data.candidate_sha256,
    artifact_id,artifact_sha256:sha256(bytes),artifact_bytes:bytes.length,
    technical_state:technical_state==='PASS'?'PASS':'UNKNOWN',
    operator_acknowledged_draft_only:true,
    operator_acknowledged_unverified:acknowledge_unverified===true,
    local_git_branch_only:true,external_pr_created:false,
    platform_publish_authority:false,customer_acceptance:false
  };
  const plan_sha256=digest('git-docs-branch',core);
  return{...core,plan_sha256,branch:'launchwright/docs-'+plan_sha256.slice(0,20)};
}
export function verifyGitDocsPlan(app,plan,root){
  ensure(plan&&typeof plan==='object'&&!Array.isArray(plan),
    'Git docs plan must be an exact bounded JSON object');
  validateValue(plan);
  const {plan_sha256,branch,...core}=plan;
  ensure(sha64(plan_sha256)&&digest('git-docs-branch',core)===plan_sha256&&
    branch==='launchwright/docs-'+plan_sha256.slice(0,20),
    'Saved Git docs review plan or branch identity has changed','Conflict');
  const observed=prepareGitDocsBranch(app,{
    repository_root:root,github_repository:core.github_repository,
    base_branch:core.base_branch,docs_path:core.docs_path,
    candidate_id:core.candidate_id,artifact_id:core.artifact_id,
    acknowledge_draft_only:core.operator_acknowledged_draft_only,
    acknowledge_unverified:core.operator_acknowledged_unverified
  });
  ensure(JSON.stringify(observed)===JSON.stringify(plan),
    'Git docs source, branch or frozen candidate differs from saved plan','StaleReference');
  return observed;
}
function verifyDocsCommit(root,plan,ref){
  ensure(sha40(ref),'Existing Git docs branch identity is invalid','Conflict');
  const parents=gitString(root,['rev-list','--parents','-n','1',ref],{max:160}).split(' ');
  ensure(parents.length===2&&parents[0]===ref&&parents[1]===plan.base_commit_sha,
    'Existing Git docs branch does not have the exact reviewed base parent','Conflict');
  const paths=decode(git(root,['diff-tree','--no-commit-id','--name-only',
    '--no-renames','-r',plan.base_commit_sha,ref],{limit:4096})).trim().split('\n');
  ensure(paths.length===1&&paths[0]===plan.docs_path,
    'Existing Git docs branch has unrelated changes','Conflict');
  const bytes=git(root,['cat-file','blob',ref+':'+plan.docs_path],{limit:BUDGET});
  ensure(bytes.length===plan.artifact_bytes&&sha256(bytes)===plan.artifact_sha256,
    'Existing Git docs branch bytes differ from approved Markdown','Conflict');
  return{branch:plan.branch,commit_sha:ref,source_artifact_sha256:plan.artifact_sha256,
    state:'LOCAL_BRANCH_READY',github_pr_created:false,
    published:false,external_network_access_performed:false,
    platform_authority:false};
}
function branchReceipt(root,plan){
  const ref=gitString(root,['rev-parse','--verify','--quiet','refs/heads/'+plan.branch],{allowMissing:true,max:80});
  if(ref===null)return null;
  return verifyDocsCommit(root,plan,ref);
}
// R41 read-only handoff: a remote draft PR may be considered only after the
// exact local branch/commit has actually been created and revalidated.
export function inspectGitDocsBranch(app,plan,repoRoot){
  verifyGitDocsPlan(app,plan,repoRoot);
  const existing=branchReceipt(rootCheck(repoRoot),plan);
  ensure(!!existing,'Approved local docs branch does not exist; prepare/apply it first','NotFound');
  return existing;
}
export function applyGitDocsBranch(app,plan,repoRoot,{
  confirm_plan_sha256,confirm_candidate_sha256,confirm_base_commit_sha,
  acknowledge_local_git_write
}={}){
  verifyGitDocsPlan(app,plan,repoRoot);
  ensure(confirm_plan_sha256===plan.plan_sha256 &&
    confirm_candidate_sha256===plan.candidate_sha256 &&
    confirm_base_commit_sha===plan.base_commit_sha &&
    acknowledge_local_git_write===true,
    'Operator must type the exact plan/candidate/base SHA and consent to a local Git branch',
    'ConsentRequired');
  const root=rootCheck(repoRoot);
  const old=branchReceipt(root,plan);
  if(old)return{...old,recovered:true,local_git_write_performed:false};
  const {bytes}=candidateBytes(app,plan.candidate_id,plan.artifact_id,
    plan.operator_acknowledged_unverified);
  const tmp=mkdtempSync(join(tmpdir(),'launchwright-git-docs-index-'));
  try{
    const env={
      GIT_INDEX_FILE:join(tmp,'review.index'),
      GIT_AUTHOR_NAME:'Launchwright Docs Draft',
      GIT_AUTHOR_EMAIL:'launchwright-docs@example.invalid',
      GIT_COMMITTER_NAME:'Launchwright Docs Draft',
      GIT_COMMITTER_EMAIL:'launchwright-docs@example.invalid'
    };
    git(root,['read-tree',plan.base_commit_sha],{env,limit:2048});
    const blob=decode(git(root,['hash-object','-w','--no-filters','--stdin'],{
      env,input:bytes,limit:80
    })).trim();
    ensure(sha40(blob),'Written Git object is not a full blob SHA','ProtocolMismatch');
    git(root,['update-index','--add','--cacheinfo',
      '100644',blob,plan.docs_path],{env,limit:2048});
    const tree=gitString(root,['write-tree'],{max:80,env});
    ensure(sha40(tree)&&tree!==plan.base_tree_sha,
      'Docs candidate would create no change or an invalid tree','Conflict');
    const message='docs: Launchwright candidate '+plan.candidate_id+' ('+
      plan.plan_sha256.slice(0,12)+')';
    const commit=decode(git(root,['commit-tree',tree,
      '-p',plan.base_commit_sha,'-m',message],{env,limit:80})).trim();
    ensure(sha40(commit),'Scoped Git docs commit is invalid','ProtocolMismatch');
    // Validate the complete commit BEFORE publishing a local branch ref. This
    // checks exact parent/base, only the requested docs path, and exact bytes.
    const inspected=verifyDocsCommit(root,plan,commit);
    git(root,['update-ref','refs/heads/'+plan.branch,
      commit,'0'.repeat(40)],{limit:2048});
    const readback=branchReceipt(root,plan);
    ensure(readback?.commit_sha===inspected.commit_sha,
      'Written Git docs branch differs from the verified commit','Conflict');
    return{...readback,recovered:false,local_git_write_performed:true};
  } finally{rmSync(tmp,{recursive:true,force:true});}
}
