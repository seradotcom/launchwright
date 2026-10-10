#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// R59 exact R55 masked Native Media to offline script-free review ZIP.
// Operator-declared pixel masks only; no public publication or app execution.
import { lstatSync,readFileSync,writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LaunchwrightApplication } from '../src/application.mjs';
import { planMaskedInteractiveDemo,exportMaskedInteractiveDemo }
  from '../src/masked-interactive-demo.mjs';

const[command='help',...args]=process.argv.slice(2);
const values=new Set(['state','input','out','plan','out-dir',
  'confirm-plan','confirm-media']);
const flags=new Set(['acknowledge-private-export','acknowledge-remaining-privacy-unknown']);
const print=data=>process.stdout.write(JSON.stringify(data,null,2)+'\n');
function options(){
  const found={};
  for(let i=0;i<args.length;i++){
    const key=args[i];
    if(!key.startsWith('--')||Object.hasOwn(found,key))
      throw Error('Unexpected or repeated option');
    const id=key.slice(2);
    if(flags.has(id)){found[id]=true;continue;}
    if(!values.has(id)||!args[i+1]||args[i+1].startsWith('--'))
      throw Error('Unsupported or missing --'+id);
    found[id]=args[++i];
  }
  return found;
}
function privateJson(path,max){
  if(!path)throw Error('An explicit private JSON path is required');
  const file=resolve(path),st=lstatSync(file);
  if(!st.isFile()||st.isSymbolicLink()||st.size>max||
    (process.platform!=='win32'&&(st.mode&0o077)!==0))
    throw Error('Private input must be a regular 0600 JSON file inside configured budget');
  return JSON.parse(readFileSync(file,'utf8'));
}
async function main(){
  if(command==='help'){
    process.stdout.write(
      'R59 owner-only offline demo from EXACT R55 masked PNG + Native derivatives.\n'+
      ' plan --state DIR --input PRIVATE_R59_JSON --out PRIVATE_PLAN_JSON\n'+
      ' export --state DIR --input PRIVATE_R59_JSON --plan PRIVATE_PLAN_JSON --out-dir PRIVATE_0700_DIR\n'+
      '        --confirm-plan PLAN_SHA256 --confirm-media MEDIA_DIGEST\n'+
      '        --acknowledge-private-export --acknowledge-remaining-privacy-unknown\n'+
      ' Never contacts the original app, web, Platform or third parties.\n'
    );return;
  }
  if(!['plan','export'].includes(command))throw Error('Unknown masked demo command');
  const o=options(),allowed=command==='plan'
    ?['state','input','out']
    :['state','input','plan','out-dir','confirm-plan','confirm-media',
      'acknowledge-private-export','acknowledge-remaining-privacy-unknown'];
  if(Object.keys(o).some(x=>!allowed.includes(x))||!o.state||!o.input)
    throw Error('Masked demo command has unsupported or missing arguments');
  const app=new LaunchwrightApplication(resolve(o.state));
  try{
    const input=privateJson(o.input,512*1024);
    if(command==='plan'){
      if(!o.out)throw Error('An exclusive private output plan JSON is required');
      const plan=planMaskedInteractiveDemo(app,input);
      writeFileSync(resolve(o.out),JSON.stringify(plan,null,2)+'\n',{
        flag:'wx',mode:0o600
      });
      print({saved_plan:resolve(o.out),plan_sha256:plan.plan_sha256,
        media_plan_digest:plan.media_plan_digest,mask_proof_count:plan.masks.length,
        technical_state:'UNKNOWN',workspace_mutated:false,
        original_source_executed:false,publication_authority:false});
      return;
    }
    const plan=privateJson(o.plan,64*1024);
    if(!o['out-dir'])throw Error('Choose an existing 0700 output directory');
    const receipt=await exportMaskedInteractiveDemo(app,plan,input,resolve(o['out-dir']),{
      confirm_plan_sha256:o['confirm-plan'],
      confirm_media_plan_digest:o['confirm-media'],
      acknowledge_private_export:o['acknowledge-private-export']===true,
      acknowledge_privacy_outside_masks_unknown:
        o['acknowledge-remaining-privacy-unknown']===true
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
