#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// R41: two-phase owner GitHub DRAFT PR after a separately pushed exact
// R40 branch. No Git push, merge, publish or retry of unknown remote outcomes.
import { existsSync,lstatSync,readFileSync,writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LaunchwrightApplication } from '../src/application.mjs';
import {
  prepareGitDocsDraftPR,sendGitDocsDraftPR,createGithubDocsTransport
} from '../src/git-docs-draft-pr.mjs';
const [command='help',...argv]=process.argv.slice(2);
const valued=new Set(['state','repo-root','branch-plan','intent','title','note',
  'out','confirm-repo','confirm-branch-plan','confirm-commit']);
const switches=new Set(['acknowledge-draft-only','acknowledge-first-send']);
function args(){
  const input={};
  for(let i=0;i<argv.length;i++){
    const name=argv[i];
    if(!name.startsWith('--')||Object.hasOwn(input,name))
      throw Error('Unexpected/duplicate Git docs PR option');
    const key=name.slice(2);
    if(switches.has(key)){input[key]=true;continue;}
    if(!valued.has(key)||!argv[i+1]||argv[i+1].startsWith('--'))
      throw Error('Unknown/missing Git docs PR option');
    input[key]=argv[++i];
  }
  return input;
}
function exactly(input,allowed){
  if(Object.keys(input).some(x=>!allowed.includes(x)))
    throw Error('Unexpected Git docs PR option or command mismatch');
}
function privateJson(path,label){
  if(!path)throw Error(label+' file must be supplied');
  const file=resolve(path),st=lstatSync(file);
  if(!st.isFile()||st.isSymbolicLink()||st.size>16*1024||
    (process.platform!=='win32'&&(st.mode&0o077)!==0))
    throw Error(label+' must be private 0600 regular JSON, max 16 KiB');
  return JSON.parse(readFileSync(file,'utf8'));
}
const print=value=>process.stdout.write(JSON.stringify(value,null,2)+'\n');
async function main(){
  if(command==='help'){
    process.stdout.write('R41 operator-owned GitHub DRAFT PR handoff. Manually push the exact R40 branch first.\n'+
      ' plan --state DIR --repo-root OWNED_REPO --branch-plan PRIVATE_R40_PLAN --title TITLE --out PRIVATE_R41_PLAN --acknowledge-draft-only [--note EDITOR_NOTE]\n'+
      ' send --state DIR --repo-root OWNED_REPO --branch-plan PRIVATE_R40_PLAN --intent PRIVATE_R41_PLAN --confirm-repo OWNER/REPO --confirm-branch-plan PLAN_SHA256 --confirm-commit GIT_SHA --acknowledge-first-send [--out PRIVATE_RECEIPT]\n'+
      ' recover --state DIR --repo-root OWNED_REPO --branch-plan PRIVATE_R40_PLAN --intent PRIVATE_R41_PLAN --confirm-repo OWNER/REPO --confirm-branch-plan PLAN_SHA256 --confirm-commit GIT_SHA [--out PRIVATE_RECEIPT]\n'+
      ' This never pushes/merges/publishes. Recover never creates a PR.\n');
    return;
  }
  if(!['plan','send','recover'].includes(command))throw Error('Unknown Git docs PR action');
  const input=args();
  exactly(input,command==='plan'
    ? ['state','repo-root','branch-plan','title','note','out','acknowledge-draft-only']
    : ['state','repo-root','branch-plan','intent','confirm-repo','confirm-branch-plan',
       'confirm-commit','out','acknowledge-first-send']);
  if(!input.state||!input['repo-root'])
    throw Error('Operator must choose exact local Launchwright state and Git root');
  const app=new LaunchwrightApplication(resolve(input.state));
  try{
    const plan=privateJson(input['branch-plan'],'R40 local branch plan');
    if(command==='plan'){
      if(!input.out)throw Error('Private R41 draft intent --out path is required');
      const intent=prepareGitDocsDraftPR(app,plan,resolve(input['repo-root']),{
        title:input.title,editorial_note:input.note??'',
        acknowledge_draft_only:input['acknowledge-draft-only']===true
      });
      writeFileSync(resolve(input.out),JSON.stringify(intent,null,2)+'\n',{
        flag:'wx',mode:0o600
      });
      print({private_intent_saved:resolve(input.out),intent_sha256:intent.intent_sha256,
        repository:intent.repository,head_branch:intent.head_branch,
        local_commit_sha:intent.local_branch_commit_sha,
        remote_mutations_performed:false,github_pr_created:false});
      return;
    }
    const intent=privateJson(input.intent,'R41 draft PR intent');
    // Refuse a conflicting operator receipt path BEFORE touching GitHub; a
    // lost filesystem write after remote creation must never cause a blind
    // second remote send.
    if(input.out&&existsSync(resolve(input.out)))
      throw Error('Private GitHub draft receipt already exists; use its original contents instead of overwriting');
    if(command==='recover'&&input['acknowledge-first-send'])
      throw Error('Recover-only cannot acknowledge any external send');
    const result=await sendGitDocsDraftPR(app,plan,resolve(input['repo-root']),
      intent,createGithubDocsTransport(),{
        confirm_repository:input['confirm-repo'],
        confirm_branch_plan_sha256:input['confirm-branch-plan'],
        confirm_local_commit_sha:input['confirm-commit'],
        recover_only:command==='recover',
        acknowledge_first_send:command==='send'&&input['acknowledge-first-send']===true
      });
    if(input.out)writeFileSync(resolve(input.out),JSON.stringify(result,null,2)+'\n',{
      flag:'wx',mode:0o600
    });
    print(result);
  }finally{app.close();}
}
main().catch(err=>{
  print({error:{code:err.code??'InvalidArgument',
    message:err.message,
    outcome_known:err.outcomeKnown??false}});
  process.exitCode=1;
});
