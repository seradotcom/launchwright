#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// R44 private Apple/Google store listing package (no store account or upload).
import { lstatSync,readFileSync,writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LaunchwrightApplication } from '../src/application.mjs';
import { planStorePackage,exportStorePackage } from '../src/store-package.mjs';

const [command='help',...argv]=process.argv.slice(2);
const valued=new Set([
  'state','input','plan','out','out-dir','confirm-plan','confirm-candidate'
]);
const switches=new Set(['acknowledge-private-export']);
const print=value=>process.stdout.write(JSON.stringify(value,null,2)+'\n');
function parse(){
  const out={};
  for(let i=0;i<argv.length;i++){
    const token=argv[i];
    if(!token.startsWith('--')||Object.hasOwn(out,token))
      throw Error('Unexpected or duplicate store package option');
    const key=token.slice(2);
    if(switches.has(key)){out[key]=true;continue;}
    if(!valued.has(key)||!argv[i+1]||argv[i+1].startsWith('--'))
      throw Error('Unsupported or missing store package option: '+key);
    out[key]=argv[++i];
  }
  return out;
}
function readPrivate(path,max,label){
  if(!path)throw Error('A private '+label+' file must be selected');
  const file=resolve(path),st=lstatSync(file);
  if(!st.isFile()||st.isSymbolicLink()||st.size>max||st.size<2||
    (process.platform!=='win32'&&(st.mode&0o077)!==0))
    throw Error(label+' must be a private regular JSON (0600 on POSIX)');
  return JSON.parse(readFileSync(file,'utf8'));
}
async function main(){
  if(command==='help'){
    process.stdout.write('R44 private Apple/Google store listing asset pack — never uploads.\n'+
      ' plan --state DIR --input PRIVATE_SOURCE_JSON --out PRIVATE_PLAN_JSON\n'+
      ' export --state DIR --input PRIVATE_SOURCE_JSON --plan PRIVATE_PLAN_JSON --out-dir EXISTING_0700_DIR --confirm-plan SHA256 --confirm-candidate SHA256 --acknowledge-private-export\n'+
      ' Input JSON includes exact owned screenshot paths, capture evidence IDs, candidate and channel IDs, metadata and separate rights/privacy acknowledgements.\n');
    return;
  }
  if(!['plan','export'].includes(command))throw Error('Unknown store package command');
  const options=parse();
  const allowed=command==='plan'?['state','input','out']:
    ['state','input','plan','out-dir','confirm-plan','confirm-candidate',
      'acknowledge-private-export'];
  if(Object.keys(options).some(x=>!allowed.includes(x))||!options.state||!options.input)
    throw Error('Store command contains extra or missing options');
  const app=new LaunchwrightApplication(resolve(options.state));
  try{
    const input=readPrivate(options.input,128*1024,'store source selection');
    if(command==='plan'){
      if(!options.out)throw Error('Choose a private output plan JSON');
      const plan=planStorePackage(app,input);
      writeFileSync(resolve(options.out),JSON.stringify(plan,null,2)+'\n',{
        flag:'wx',mode:0o600
      });
      print({saved_plan:resolve(options.out),
        plan_sha256:plan.plan_sha256,candidate_sha256:plan.candidate_sha256,
        platform:plan.platform,screenshot_count:plan.screenshot_count,
        file_mutations_performed:false,store_api_upload_performed:false,
        platform_authority:false});
      return;
    }
    if(!options['out-dir'])throw Error('Choose a private existing output directory');
    const plan=readPrivate(options.plan,64*1024,'store plan');
    const receipt=await exportStorePackage(app,plan,input,resolve(options['out-dir']),{
      confirm_plan_sha256:options['confirm-plan'],
      confirm_candidate_sha256:options['confirm-candidate'],
      acknowledge_private_export:options['acknowledge-private-export']===true
    });
    print(receipt);
  }finally{app.close();}
}
main().catch(error=>{
  print({error:{code:error.code??'InvalidArgument',
    message:error.message,outcome_known:error.outcomeKnown??true}});
  process.exitCode=1;
});
