#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// R43: operator-owned, exact two-phase static offline walkthrough packaging.
// The CLI reads the original private screenshot selections; it never finds
// local files by agent inference or executes a source project.
import { lstatSync,readFileSync,writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LaunchwrightApplication } from '../src/application.mjs';
import { planInteractiveDemo,exportInteractiveDemo } from '../src/interactive-demo.mjs';

const [action='help',...tokens]=process.argv.slice(2);
const strings=new Set(['state','input','plan','out','out-dir','confirm-plan','confirm-media']);
const switches=new Set(['acknowledge-private-export']);
const print=value=>process.stdout.write(JSON.stringify(value,null,2)+'\n');
function parse(){
  const args={};
  for(let i=0;i<tokens.length;i++){
    const token=tokens[i];
    if(!token.startsWith('--'))throw Error('Unexpected interactive demo argument');
    const key=token.slice(2);
    if(Object.hasOwn(args,key))throw Error('Duplicate interactive demo argument');
    if(switches.has(key)){args[key]=true;continue;}
    if(!strings.has(key)||!tokens[i+1]||tokens[i+1].startsWith('--'))
      throw Error('Unsupported option or missing argument');
    args[key]=tokens[++i];
  }
  return args;
}
function privateJson(path,label){
  if(!path)throw Error(label+' private JSON file path is required');
  const file=resolve(path),stat=lstatSync(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>64*1024||
    (process.platform!=='win32'&&(stat.mode&0o077)!==0))
    throw Error(label+' must be a regular private JSON file (0600 POSIX, <=64 KiB)');
  return JSON.parse(readFileSync(file,'utf8'));
}
async function main(){
  if(action==='help'){
    process.stdout.write(
      'R43 offline HTML walkthrough from operator-declared sanitized Media screenshots.\n'+
      ' plan --state WORKSPACE --input PRIVATE_SCREENSHOT_JSON --out PRIVATE_PLAN_JSON\n'+
      ' export --state WORKSPACE --input PRIVATE_SCREENSHOT_JSON --plan PRIVATE_PLAN_JSON --out-dir PRIVATE_0700_DIR\n'+
      '        --confirm-plan PLAN_SHA256 --confirm-media MEDIA_PLAN_DIGEST --acknowledge-private-export\n'+
      ' Only private static exports. No source execution, network or publication.\n'
    );
    return;
  }
  if(!['plan','export'].includes(action))throw Error('Unknown demo command');
  const options=parse();
  const allowed=action==='plan'
    ? ['state','input','out'] :
    ['state','input','plan','out-dir','confirm-plan','confirm-media','acknowledge-private-export'];
  if(Object.keys(options).some(k=>!allowed.includes(k))||!options.state)
    throw Error('Demo command requires exact source state and supported options');
  const app=new LaunchwrightApplication(resolve(options.state));
  try{
    const input=privateJson(options.input,'Source screenshot selection');
    if(action==='plan'){
      if(!options.out)throw Error('Private --out plan file is required');
      const plan=planInteractiveDemo(app,input);
      writeFileSync(resolve(options.out),JSON.stringify(plan,null,2)+'\n',{
        flag:'wx',mode:0o600
      });
      print({schema_version:'launchwright-offline-demo-plan-summary/1',
        plan_file_created:true,plan_sha256:plan.plan_sha256,
        media_plan_digest:plan.media_plan_digest,frame_count:plan.frame_count,
        source_metadata_paths_in_plan:false,workspace_mutated:false,
        technical_state:'UNKNOWN',publication_authority:false});
      return;
    }
    if(!options['out-dir'])throw Error('Private --out-dir is required');
    const plan=privateJson(options.plan,'Exact saved demo plan');
    print(await exportInteractiveDemo(app,plan,input,resolve(options['out-dir']),{
      confirm_plan_sha256:options['confirm-plan'],
      confirm_media_plan_digest:options['confirm-media'],
      acknowledge_private_export:options['acknowledge-private-export']===true
    }));
  }finally{app.close();}
}
main().catch(error=>{
  print({error:{code:error.code??'InvalidArgument',
    message:error.message,outcome_known:error.outcomeKnown??true}});
  process.exitCode=1;
});
