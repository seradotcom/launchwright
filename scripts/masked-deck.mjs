#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// R57 operator opt-in, two-phase local masked deck export.
import { lstatSync,readFileSync,writeFileSync } from 'node:fs';
import {resolve} from 'node:path';
import {LaunchwrightApplication} from '../src/application.mjs';
import {prepareMaskedDeck,exportMaskedDeck} from '../src/masked-deck.mjs';

const [command='help',...argv]=process.argv.slice(2);
const known=new Set(['state','input','out','plan','out-dir','confirm-plan','confirm-candidate','approve-export']);
const opts={};
for(let i=0;i<argv.length;i++){
  const name=argv[i];
  if(!name.startsWith('--')||!known.has(name.slice(2))||Object.hasOwn(opts,name))
    throw Error('Unexpected option');
  if(name==='--approve-export'){opts[name]=true;continue;}
  if(!argv[i+1]||argv[i+1].startsWith('--'))throw Error('Missing option value');
  opts[name]=argv[++i];
}
const emit=x=>process.stdout.write(JSON.stringify(x,null,2)+'\n');
function readJSON(filename,max=512*1024){
  if(!filename)throw Error('A saved JSON path is required');
  const path=resolve(filename),s=lstatSync(path);
  if(!s.isFile()||s.isSymbolicLink()||s.size>max||s.size<=0||
    (process.platform!=='win32'&&(s.mode&0o077)!==0))
    throw Error('Saved input must be a 0600 regular JSON file within budget');
  return JSON.parse(readFileSync(path,'utf8'));
}
async function main(){
  if(command==='help'){console.log(
    'plan --state DIR --input PRIVATE_JSON --out PLAN_JSON\n'+
    'export --state DIR --input SAME_JSON --plan PLAN_JSON --out-dir PRIVATE_DIR --confirm-plan SHA256 --confirm-candidate SHA256 --approve-export'
  );return;}
  if(!['plan','export'].includes(command)||!opts['--state']||!opts['--input'])
    throw Error('Unsupported command or missing state/input');
  const allowed=command==='plan'
    ? ['--state','--input','--out']
    : ['--state','--input','--plan','--out-dir','--confirm-plan','--confirm-candidate','--approve-export'];
  if(Object.keys(opts).some(key=>!allowed.includes(key)))throw Error('Extra option');
  const app=new LaunchwrightApplication(resolve(opts['--state']));
  try{
    const input=readJSON(opts['--input']);
    if(command==='plan'){
      const plan=prepareMaskedDeck(app,input);
      if(!opts['--out'])throw Error('Missing plan destination');
      writeFileSync(resolve(opts['--out']),JSON.stringify(plan,null,2)+'\n',
        {flag:'wx',mode:0o600});
      emit({plan_sha256:plan.plan_sha256,candidate_sha256:plan.candidate_sha256,
        screenshot_count:plan.screenshot_count,pages:plan.slide_count,
        workspace_mutated:false,technical_state:'UNKNOWN'});
    }else{
      const plan=readJSON(opts['--plan'],48*1024);
      const result=await exportMaskedDeck(app,plan,input,resolve(opts['--out-dir']),{
        confirm_plan_sha256:opts['--confirm-plan'],
        confirm_candidate_sha256:opts['--confirm-candidate'],
        acknowledge_private_export:opts['--approve-export']===true
      });
      emit(result);
    }
  }finally{app.close();}
}
main().catch(e=>{emit({error:{code:e.code??'InvalidArgument',message:e.message}});
  process.exitCode=1;});
