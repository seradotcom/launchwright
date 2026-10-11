#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// R64 two-phase private multi-format review kit, no channel/publisher send.
import { lstatSync,readFileSync,writeFileSync } from 'node:fs';
import {resolve} from 'node:path';
import {LaunchwrightApplication} from '../src/application.mjs';
import {planReleaseReviewKit,exportReleaseReviewKit} from '../src/release-review-kit.mjs';
const [action='help',...args]=process.argv.slice(2);
const params=new Set(['state','input','out','plan','out-dir','confirm-plan','confirm-candidate']);
const switches=new Set(['acknowledge-private-export']);
const output=x=>process.stdout.write(JSON.stringify(x,null,2)+'\n');
function opts(){
  const v={};
  for(let i=0;i<args.length;i++){
    const flag=args[i],k=flag.startsWith('--')?flag.slice(2):'';
    if(!k||Object.hasOwn(v,k))throw Error('Duplicate/unsupported kit option');
    if(switches.has(k)){v[k]=true;continue;}
    if(!params.has(k)||!args[i+1]||args[i+1].startsWith('--'))
      throw Error('Unexpected or missing kit option');
    v[k]=args[++i];
  }
  return v;
}
function readPrivate(name,budget){
  if(!name)throw Error('Missing private JSON input');
  const file=resolve(name),st=lstatSync(file);
  if(!st.isFile()||st.isSymbolicLink()||st.size<2||st.size>budget||
    (process.platform!=='win32'&&(st.mode&0o077)!==0))
    throw Error('Input must be a private 0600 regular JSON file within budget');
  return JSON.parse(readFileSync(file,'utf8'));
}
async function main(){
  if(action==='help'){
    process.stdout.write(
      'R64: cross-output private release kit from exact R45 docs/R42 deck and optional R61 masked demo.\n'+
      ' plan --state DIR --input PRIVATE_SOURCE_SELECTION_JSON --out PRIVATE_PLAN_JSON\n'+
      ' export --state DIR --input PRIVATE_SOURCE_SELECTION_JSON --plan PRIVATE_PLAN_JSON '+
      '--out-dir PRIVATE_0700_DIR --confirm-plan PLAN_SHA256 --confirm-candidate CANDIDATE_SHA256 '+
      '--acknowledge-private-export\n'+
      ' Selection: {"docs":{"plan":{...},"directory":"/private/docs"},'+
      '"deck":{"plan":{...},"directory":"/private/deck"},'+
      '"acknowledge_rights":true,"acknowledge_private_only":true}'+
      ' with optional "demo":{"plan":{...},"directory":"/private/masked-demo"}.\n'+
      ' No git execution, remote network, rights/PII certification or public publication.\n');
    return;
  }
  if(!['plan','export'].includes(action))throw Error('Unsupported kit action');
  const v=opts(),allowed=new Set(action==='plan'
    ? ['state','input','out']
    : ['state','input','plan','out-dir','confirm-plan',
       'confirm-candidate','acknowledge-private-export']);
  if(!v.state||!v.input||Object.keys(v).some(k=>!allowed.has(k)))
    throw Error('Kit action requires state, exact selection and supported options only');
  const input=readPrivate(v.input,96*1024),app=new LaunchwrightApplication(resolve(v.state));
  try{
    if(action==='plan'){
      if(!v.out)throw Error('A private --out JSON path is required');
      const plan=await planReleaseReviewKit(app,input);
      writeFileSync(resolve(v.out),JSON.stringify(plan,null,2)+'\n',{mode:0o600,flag:'wx'});
      output({saved_plan:resolve(v.out),
        plan_sha256:plan.plan_sha256,candidate_sha256:plan.candidate_sha256,
        release_id:plan.release_id,formats:plan.outputs,
        workspace_mutated:false,external_network:false,
        technical_state:'UNKNOWN',publication_authority:false});
    }else{
      if(!v['out-dir'])throw Error('Explicit private output directory is required');
      const plan=readPrivate(v.plan,24*1024);
      output(await exportReleaseReviewKit(app,plan,input,resolve(v['out-dir']),{
        confirm_plan_sha256:v['confirm-plan'],
        confirm_candidate_sha256:v['confirm-candidate'],
        acknowledge_export:v['acknowledge-private-export']===true
      }));
    }
  }finally{app.close();}
}
main().catch(e=>{
  output({error:{code:e.code??'InvalidArgument',
    message:e.message,outcome_known:e.outcomeKnown??true}});
  process.exitCode=1;
});
