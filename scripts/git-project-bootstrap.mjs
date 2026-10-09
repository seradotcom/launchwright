#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// R35 two-phase operator-owned existing-Git-project bootstrap.
import { readFileSync, writeFileSync, lstatSync } from 'node:fs';
import { resolve } from 'node:path';
import { LaunchwrightApplication } from '../src/application.mjs';
import { planGitProjectBootstrap, applyGitProjectBootstrap, withGitBootstrapLock } from '../src/git-project-bootstrap.mjs';

const [command='help',...args]=process.argv.slice(2);
const options=new Set([
  'state','in','plan-file','out','product','release','source-name','target',
  'notes-title','purpose','locale','role','plan-label','region','rights',
  'confirm-plan','confirm-head'
]);
const switches=new Set([
  'approve-source','declare-rights','acknowledge-imported','acknowledge-editorial-draft'
]);
function parseArgs(){
  const result={};
  for(let i=0;i<args.length;i++){
    const token=args[i];
    if(!token.startsWith('--'))throw Error('Unexpected positional CLI argument');
    const key=token.slice(2);
    if(Object.hasOwn(result,key))throw Error('Duplicate option: --'+key);
    if(switches.has(key)){result[key]=true;continue;}
    if(!options.has(key))throw Error('Unsupported option: --'+key);
    const value=args[++i];
    if(!value||value.startsWith('--'))throw Error('Missing value for --'+key);
    result[key]=value;
  }
  return result;
}
function privateJson(filename){
  if(!filename)throw Error('A private JSON file path is required');
  const path=resolve(filename);
  const stat=lstatSync(path);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1024*1024||
    (process.platform!=='win32'&&(stat.mode&0o077)!==0))
    throw Error('Input must be a private regular JSON file (0600 on POSIX, at most 1 MiB)');
  return JSON.parse(readFileSync(path,'utf8'));
}
function print(value){process.stdout.write(JSON.stringify(value,null,2)+'\n');}
function operatorOptions(o){
  return {
    product_name:o.product,release_name:o.release,source_name:o['source-name'],
    target_name:o.target,notes_title:o['notes-title'],
    source_purpose:o.purpose,locale:o.locale,role:o.role,plan:o['plan-label'],
    region:o.region,rights:o.rights
  };
}
async function main(){
  if(command==='help'){
    console.log('R35 local Git project onboarding: only imported UNKNOWN evidence / editorial drafts\n'+
      ' plan --in PRIVATE_OBSERVATION_JSON --out PRIVATE_PLAN_JSON --product NAME --release NAME\n'+
      '      --source-name NAME --target NAME --notes-title NAME --purpose TEXT\n'+
      '      --locale en-US --role ROLE --plan-label PLAN --region REGION --rights owned|licensed\n'+
      ' apply --state EXISTING_WORKSPACE --in PRIVATE_OBSERVATION_JSON --plan-file PRIVATE_PLAN_JSON\n'+
      '       --confirm-plan PLAN_SHA256 --confirm-head HEAD_SHA --approve-source --declare-rights\n'+
      '       --acknowledge-imported --acknowledge-editorial-draft\n'+
      'Never fetches a Git repo, executes project scripts, grants Graph authority or publishes.');
    return;
  }
  if(!['plan','apply'].includes(command))throw Error('Unknown bootstrap command');
  const o=parseArgs();
  if(command==='plan'){
    const allowed=new Set(['in','out','product','release','source-name','target','notes-title',
      'purpose','locale','role','plan-label','region','rights']);
    if(Object.keys(o).some(k=>!allowed.has(k)))throw Error('Plan command includes unsupported options');
    if(!o.out)throw Error('A private --out file is required');
    const observation=privateJson(o.in);
    const plan=planGitProjectBootstrap(observation,operatorOptions(o));
    const file=resolve(o.out);
    writeFileSync(file,JSON.stringify(plan,null,2)+'\n',{flag:'wx',mode:0o600});
    print({saved:file,plan_sha256:plan.plan_sha256,source_alias:plan.source_alias,
      head_sha:plan.head_sha,changed_files:plan.changed_files,commit_count:plan.commit_count,
      has_private_paths:false,workspace_mutated:false,network_access_performed:false,
      technical_state:'UNKNOWN',requires_explicit_application:true});
    return;
  }
  const allowed=new Set(['state','in','plan-file','confirm-plan','confirm-head',...switches]);
  if(Object.keys(o).some(k=>!allowed.has(k)))throw Error('Apply command includes unsupported options');
  if(!o.state)throw Error('--state EXISTING_WORKSPACE is required');
  const observation=privateJson(o.in),plan=privateJson(o['plan-file']);
  const app=new LaunchwrightApplication(resolve(o.state));
  try{
    const result=await withGitBootstrapLock(app.store.root,()=>
      applyGitProjectBootstrap(app,plan,observation,{
        confirm_plan_sha256:o['confirm-plan'],confirm_head_sha:o['confirm-head'],
        acknowledge_source_approval:o['approve-source']===true,
        acknowledge_rights:o['declare-rights']===true,
        acknowledge_imported:o['acknowledge-imported']===true,
        acknowledge_editorial_draft:o['acknowledge-editorial-draft']===true
      }));
    print(result);
  }finally{app.close();}
}
main().catch(error=>{
  print({error:{code:error.code??'InvalidArgument',message:error.message,
    outcome_known:error.outcomeKnown??true}});
  process.exitCode=1;
});
