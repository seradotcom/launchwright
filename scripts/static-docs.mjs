#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// R45: operator-approved plan/export, never a docs website deployment.
import { lstatSync,readFileSync,writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LaunchwrightApplication } from '../src/application.mjs';
import { planStaticDocs,exportStaticDocs } from '../src/static-docs.mjs';

const [command='help',...argv]=process.argv.slice(2);
const fields=new Set(['state','candidate','pages-file','out','plan-file','out-dir',
  'confirm-plan','confirm-candidate']);
const flags=new Set(['acknowledge-draft','acknowledge-source-rights','acknowledge-unknown',
  'acknowledge-private-export']);
function parse(){
  const result={};
  for(let i=0;i<argv.length;i++){
    const key=argv[i];
    if(!key.startsWith('--')||Object.hasOwn(result,key))
      throw Error('Duplicate or unexpected static docs option');
    const name=key.slice(2);
    if(flags.has(name)){result[name]=true;continue;}
    if(!fields.has(name)||!argv[i+1]||argv[i+1].startsWith('--'))
      throw Error('Unknown or missing static docs option: '+name);
    result[name]=argv[++i];
  }
  return result;
}
function privateJson(path,max){
  if(!path)throw Error('An explicit private JSON input file is required');
  const file=resolve(path),stat=lstatSync(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>max||
    (process.platform!=='win32'&&(stat.mode&0o077)!==0))
    throw Error('Input JSON must be a private regular file (0600 on POSIX)');
  return JSON.parse(readFileSync(file,'utf8'));
}
const print=value=>process.stdout.write(JSON.stringify(value,null,2)+'\n');
async function main(){
  if(command==='help'){
    process.stdout.write(
      'R45 owner-only versioned static docs (offline, script-free, no publication)\n'+
      ' plan --state DIR --candidate ID --pages-file PRIVATE_JSON --out PRIVATE_PLAN --acknowledge-draft --acknowledge-source-rights [--acknowledge-unknown]\n'+
      ' export --state DIR --plan-file PRIVATE_PLAN --out-dir PRIVATE_0700_DIR --confirm-plan SHA256 --confirm-candidate SHA256 --acknowledge-private-export\n'+
      ' Pages JSON is an array of {slug,artifact_id}, referring ONLY to frozen Candidate markdown artifacts.\n'
    );return;
  }
  if(!['plan','export'].includes(command))throw Error('Unsupported static docs command');
  const input=parse();
  const allowed=command==='plan'?
    new Set(['state','candidate','pages-file','out','acknowledge-draft','acknowledge-source-rights','acknowledge-unknown']):
    new Set(['state','plan-file','out-dir','confirm-plan','confirm-candidate','acknowledge-private-export']);
  if(!input.state||Object.keys(input).some(k=>!allowed.has(k)))
    throw Error('Static docs command has missing or unsupported options');
  const app=new LaunchwrightApplication(resolve(input.state));
  try{
    if(command==='plan'){
      if(!input.out)throw Error('Choose a new private --out plan file');
      const pages=privateJson(input['pages-file'],24*1024);
      const plan=await planStaticDocs(app,{
        candidate_id:input.candidate,pages,
        acknowledge_draft_only:input['acknowledge-draft']===true,
        acknowledge_unverified:input['acknowledge-unknown']===true,
        acknowledge_source_rights:input['acknowledge-source-rights']===true
      });
      writeFileSync(resolve(input.out),JSON.stringify(plan,null,2)+'\n',{
        mode:0o600,flag:'wx'
      });
      print({saved_plan:resolve(input.out),plan_sha256:plan.plan_sha256,
        candidate_sha256:plan.candidate_sha256,
        release_build:plan.release_build,page_count:plan.page_count,
        output_zip_sha256:plan.output_zip_sha256,
        technical_state:plan.technical_state,
        workspace_mutated:false,external_network_access:false,
        publication_authority:false});
      return;
    }
    if(!input['out-dir'])throw Error('Choose a private output directory');
    const plan=privateJson(input['plan-file'],48*1024);
    const receipt=await exportStaticDocs(app,plan,resolve(input['out-dir']),{
      confirm_plan_sha256:input['confirm-plan'],
      confirm_candidate_sha256:input['confirm-candidate'],
      acknowledge_private_export:input['acknowledge-private-export']===true
    });
    print(receipt);
  }finally{app.close();}
}
main().catch(error=>{
  print({error:{
    code:error.code??'InvalidArgument',
    message:error.message,
    outcome_known:error.outcomeKnown??true
  }});
  process.exitCode=1;
});
