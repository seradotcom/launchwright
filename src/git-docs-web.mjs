// SPDX-License-Identifier: AGPL-3.0-only
// R68: local-owner HTTP facade over the existing R40 Native-bound Git docs
// plumbing. No second publication backend, arbitrary Git execution or push.
import {closeSync,openSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {NativeError,requireCondition as ensure,validateValue} from '@semwright/native-sdk';
import {prepareGitDocsBranch,applyGitDocsBranch,inspectGitDocsBranch} from './git-docs-pr.mjs';

const keys=(record,fields)=>{
  ensure(record&&typeof record==='object'&&!Array.isArray(record)&&
    Object.keys(record).length===fields.length&&
    fields.every(field=>Object.hasOwn(record,field)),
  'Unexpected or missing local Git docs fields','InvalidArgument');
};
const hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/u.test(x);
const sha=x=>typeof x==='string'&&/^[a-f0-9]{40}$/u.test(x);

export function planBrowserGitDocs(app,raw){
  app.allow('read');validateValue(raw);
  keys(raw,['repository_root','github_repository','base_branch','docs_path',
    'candidate_id','artifact_id','acknowledge_draft_only',
    'acknowledge_unverified']);
  const plan=prepareGitDocsBranch(app,raw);
  return{plan,workspace_mutated:false,local_git_write_performed:false,
    external_network_access_performed:false,github_pr_created:false,
    published:false,platform_authority:false,customer_acceptance:false};
}

export function inspectBrowserGitDocs(app,raw){
  app.allow('read');validateValue(raw);
  keys(raw,['repository_root','plan']);
  const {plan}=raw;
  ensure(plan&&hash(plan.plan_sha256),'Expected complete saved Git docs plan',
    'InvalidArgument');
  try{
    const result=inspectGitDocsBranch(app,plan,raw.repository_root);
    return{...result,plan_sha256:plan.plan_sha256,
      candidate_sha256:plan.candidate_sha256,base_commit_sha:plan.base_commit_sha,
      local_git_write_performed:false,github_pr_created:false,
      external_network_access_performed:false,published:false};
  }catch(error){
    if(error instanceof NativeError&&error.code==='NotFound')
      return{state:'NOT_APPLIED',branch:plan.branch,
        plan_sha256:plan.plan_sha256,candidate_sha256:plan.candidate_sha256,
        local_git_write_performed:false,github_pr_created:false,
        external_network_access_performed:false,published:false,
        platform_authority:false};
    throw error;
  }
}

export function applyBrowserGitDocs(app,raw){
  app.allow('edit');validateValue(raw);
  keys(raw,['repository_root','plan','confirm_plan_sha256',
    'confirm_candidate_sha256','confirm_base_commit_sha',
    'acknowledge_local_git_write']);
  const p=raw.plan;
  ensure(p&&hash(p.plan_sha256)&&hash(p.candidate_sha256)&&
    sha(p.base_commit_sha),'Expected complete pinned R40 source hashes',
    'InvalidArgument');
  // Consent is checked before taking the writer lock, launching Git or
  // writing a branch, including during manual recovery.
  ensure(raw.confirm_plan_sha256===p.plan_sha256&&
    raw.confirm_candidate_sha256===p.candidate_sha256&&
    raw.confirm_base_commit_sha===p.base_commit_sha&&
    raw.acknowledge_local_git_write===true,
    'Owner must re-enter plan, candidate and Git base hashes','ConsentRequired');
  const lock=join(app.store.root,'.git-docs-web-apply.lock');
  let fd;
  try{fd=openSync(lock,'wx',0o600);}catch{
    throw new NativeError('Conflict',
      'A Git docs write is in progress or a stale lock requires manual review');
  }
  try{
    const result=applyGitDocsBranch(app,p,raw.repository_root,{
      confirm_plan_sha256:raw.confirm_plan_sha256,
      confirm_candidate_sha256:raw.confirm_candidate_sha256,
      confirm_base_commit_sha:raw.confirm_base_commit_sha,
      acknowledge_local_git_write:true
    });
    return{...result,plan_sha256:p.plan_sha256,
      candidate_sha256:p.candidate_sha256,
      base_commit_sha:p.base_commit_sha,
      manually_pushed:false,github_pr_created:false,
      published:false,platform_authority:false,customer_acceptance:false};
  }finally{
    try{closeSync(fd);}finally{unlinkSync(lock);}
  }
}
