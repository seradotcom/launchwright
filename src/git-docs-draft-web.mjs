// SPDX-License-Identifier: AGPL-3.0-only
// R69: owner-authorized browser facade for the existing R41 GitHub DRAFT PR
// transport. Never performs push, merge, deployment, public activation.
import {NativeError,requireCondition as ensure,validateValue} from '@semwright/native-sdk';
import {openSync,closeSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {prepareGitDocsDraftPR,sendGitDocsDraftPR,createGithubDocsTransport} from './git-docs-draft-pr.mjs';
const exact=(input,fields)=>{
  ensure(input&&typeof input==='object'&&!Array.isArray(input)&&
    Object.keys(input).length===fields.length&&
    fields.every(field=>Object.hasOwn(input,field)),
    'Unexpected or missing Git docs Draft PR input fields','InvalidArgument');
};
const hash64=value=>typeof value==='string'&&/^[a-f0-9]{64}$/u.test(value);
const hash40=value=>typeof value==='string'&&/^[a-f0-9]{40}$/u.test(value);
export function planBrowserGitDocsDraft(app,input){
  app.allow('read');validateValue(input);
  exact(input,['repository_root','branch_plan','title','editorial_note',
    'acknowledge_draft_only']);
  const intent=prepareGitDocsDraftPR(app,input.branch_plan,input.repository_root,{
    title:input.title,editorial_note:input.editorial_note,
    acknowledge_draft_only:input.acknowledge_draft_only
  });
  return{intent,external_network_access_performed:false,
    remote_pr_creation_performed:false,external_branch_push_performed:false,
    published:false,platform_authority:false,customer_acceptance:false};
}

export async function sendBrowserGitDocsDraft(app,input,{
  recoverOnly=false,transport=null
}={}){
  app.allow(recoverOnly?'read':'publish');
  validateValue(input);
  const fields=['repository_root','branch_plan','intent','confirm_repository',
    'confirm_branch_plan_sha256','confirm_local_commit_sha'];
  exact(input,recoverOnly?fields:[...fields,'acknowledge_first_send',
    'acknowledge_remote_branch_pushed']);
  const plan=input.branch_plan,intent=input.intent;
  ensure(plan&&hash64(plan.plan_sha256)&&
    intent&&hash64(intent.intent_sha256)&&
    hash40(intent.local_branch_commit_sha),
    'Only exact saved R40/R41 intents can be reconciled','InvalidArgument');
  ensure(input.confirm_repository===intent.repository&&
    input.confirm_branch_plan_sha256===plan.plan_sha256&&
    input.confirm_local_commit_sha===intent.local_branch_commit_sha,
    'Confirm the exact remote repository, R40 branch and commit','ConsentRequired');
  if(!recoverOnly)ensure(input.acknowledge_first_send===true&&
    input.acknowledge_remote_branch_pushed===true,
    'Explicit first-send consent and manually pushed branch acknowledgement required',
    'ConsentRequired');
  // Real environment uses gh CLI's existing owner credentials. Unit/CI runs
  // inject a deterministic transport. No tokens cross the browser protocol.
  const lockPath=join(app.store.root,'.git-docs-draft-remote.lock');
  let fd;
  try{fd=openSync(lockPath,'wx',0o600);}catch{
    throw new NativeError('Conflict',
      'Another Draft PR operation is in flight or an unknown crash left a lock; reconcile manually, never send concurrently');
  }
  try{
    const remote=transport??createGithubDocsTransport();
    return await sendGitDocsDraftPR(app,plan,input.repository_root,intent,remote,{
      confirm_repository:input.confirm_repository,
      confirm_branch_plan_sha256:input.confirm_branch_plan_sha256,
      confirm_local_commit_sha:input.confirm_local_commit_sha,
      acknowledge_first_send:!recoverOnly,
      recover_only:recoverOnly
    });
  }finally{
    try{closeSync(fd);}finally{unlinkSync(lockPath);}
  }
}
