#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// R55 operator CLI: no-effect plan followed by consent-bound private PNG,
// metadata receipt and canonical Native SANITIZED_DERIVATIVE evidence.
import { lstatSync,readFileSync,writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LaunchwrightApplication } from '../src/application.mjs';
import { preparePixelMask, applyPixelMask } from '../src/pixel-redaction.mjs';

const [cmd='help',...argv]=process.argv.slice(2);
const paramNames=new Set([
  'state','input','plan','out','output-dir','confirm-plan','confirm-source'
]);
const flags=new Set(['acknowledge-private-write']);
function parse(){
  const out={};
  for(let i=0;i<argv.length;i++){
    const a=argv[i];
    if(!a.startsWith('--'))throw Error('Unexpected positional argument');
    const name=a.slice(2);
    if(Object.hasOwn(out,name))throw Error('Duplicate pixel-mask option: '+name);
    if(flags.has(name)){out[name]=true;continue;}
    if(!paramNames.has(name)||!argv[i+1]||argv[i+1].startsWith('--'))
      throw Error('Missing or unknown pixel-mask option: '+name);
    out[name]=argv[++i];
  }
  return out;
}
function privateJson(path,label){
  if(!path)throw Error(label+' requires a private JSON file');
  const file=resolve(path),stat=lstatSync(file);
  if(!stat.isFile()||stat.isSymbolicLink()||
    stat.size<2||stat.size>16384||
    (process.platform!=='win32'&&(stat.mode&0o077)!==0))
    throw Error(label+' must be regular owner-private JSON (0600), at most 16 KiB');
  return JSON.parse(readFileSync(file,'utf8'));
}
const print=value=>process.stdout.write(JSON.stringify(value,null,2)+'\n');
async function main(){
  if(cmd==='help'){
    process.stdout.write(
      'Launchwright R55 exact source pixel masking (NOT automatic personal-data verification)\n'+
      ' plan --state DIR --input PRIVATE_0600_MASK_REQUEST_JSON --out PRIVATE_0600_PLAN_JSON\n'+
      ' apply --state DIR --input PRIVATE_0600_MASK_REQUEST_JSON --plan PRIVATE_PLAN_JSON\n'+
      '       --output-dir PRIVATE_0700_DIRECTORY --confirm-plan PLAN_SHA256\n'+
      '       --confirm-source SOURCE_PNG_SHA256 --acknowledge-private-write\n'+
      'Never fetches source project code, erases arbitrary files or publishes anything.\n'
    );return;
  }
  if(!['plan','apply'].includes(cmd))throw Error('Unknown pixel-mask operation');
  const opts=parse();
  const permitted=cmd==='plan'
    ? ['state','input','out']
    : ['state','input','plan','output-dir','confirm-plan',
       'confirm-source','acknowledge-private-write'];
  if(Object.keys(opts).some(k=>!permitted.includes(k)))
    throw Error('Pixel-mask command supplied an unexpected option');
  if(!opts.state||!opts.input)throw Error('Workspace and private mask input are required');
  const app=new LaunchwrightApplication(resolve(opts.state));
  try{
    const input=privateJson(opts.input,'Operator mask input');
    if(cmd==='plan'){
      if(!opts.out)throw Error('Private plan destination required');
      const plan=preparePixelMask(app,input);
      writeFileSync(resolve(opts.out),JSON.stringify(plan,null,2)+'\n',{
        flag:'wx',mode:0o600
      });
      print({
        saved_plan:resolve(opts.out),
        plan_sha256:plan.plan_sha256,
        original_source_png_sha256:plan.source_png_sha256,
        derived_png_sha256:plan.masked_png_sha256,
        masked_pixels:plan.masked_pixels,total_pixels:plan.total_pixels,
        technical_state:'UNKNOWN',all_personal_information_removed:false,
        native_mutations_performed:false,external_network:false
      });
      return;
    }
    const plan=privateJson(opts.plan,'Saved mask plan');
    if(!opts['output-dir'])throw Error('Private output directory required');
    const result=await applyPixelMask(app,plan,input,resolve(opts['output-dir']),{
      confirm_plan_sha256:opts['confirm-plan'],
      confirm_source_png_sha256:opts['confirm-source'],
      acknowledge_private_file_write:opts['acknowledge-private-write']===true
    });
    print(result);
  }finally{app.close();}
}
main().catch(err=>{
  // Do not serialize input JSON, credentials or local original screenshot paths.
  print({error:{code:err.code??'InvalidArgument',
    message:err.message,
    outcome_known:err.outcomeKnown??true}});
  process.exitCode=1;
});
