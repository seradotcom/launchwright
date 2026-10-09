#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Operator-owned FFmpeg aspect-only video derivatives, never Semwright
// Composition/Platform Publish. Explicit private plan -> confirmed export.
import { lstatSync,readFileSync,writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LaunchwrightApplication } from '../src/application.mjs';
import { planVideoVariants,exportVideoVariants } from '../src/video-variants.mjs';

const [verb='help',...tokens]=process.argv.slice(2);
const valueKeys=new Set(['state','input','plan-file','out','out-dir','confirm-plan','confirm-source']);
const flags=new Set(['acknowledge-private-export']);
const print=value=>process.stdout.write(JSON.stringify(value,null,2)+'\n');
function parse(){
  const opts={};
  for(let i=0;i<tokens.length;i++){
    const flag=tokens[i];
    if(!flag.startsWith('--')||Object.hasOwn(opts,flag.slice(2)))
      throw Error('Unexpected/duplicate video variant CLI option');
    const name=flag.slice(2);
    if(flags.has(name)){opts[name]=true;continue;}
    if(!valueKeys.has(name)||!tokens[i+1]||tokens[i+1].startsWith('--'))
      throw Error('Missing or unsupported option: '+name);
    opts[name]=tokens[++i];
  }
  return opts;
}
function privateJson(file,label){
  if(!file)throw Error(label+' requires a private source JSON path');
  const stat=lstatSync(resolve(file));
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>32*1024||
    (process.platform!=='win32'&&(stat.mode&0o077)!==0))
    throw Error(label+' must be a 0600 private regular file <=32 KiB');
  return JSON.parse(readFileSync(resolve(file),'utf8'));
}
async function main(){
  if(verb==='help'){
    process.stdout.write(
      'Launchwright R46 / two exact MP4 video aspect variants and Native WebVTT.\n'+
      ' plan --state DIR --input PRIVATE_JSON --out PRIVATE_PLAN_JSON\n'+
      ' export --state DIR --input PRIVATE_JSON --plan-file PRIVATE_PLAN_JSON --out-dir PRIVATE_0700_DIR --confirm-plan PLAN_SHA --confirm-source MASTER_MP4_SHA --acknowledge-private-export\n'+
      ' This does NOT recompose a Semwright timeline, crop source UI, create alternative voice or publish.\n'
    );return;
  }
  if(!['plan','export'].includes(verb))throw Error('Unknown video variants command');
  const args=parse();
  const accepted=new Set(verb==='plan'
    ? ['state','input','out']:
      ['state','input','plan-file','out-dir','confirm-plan','confirm-source',
       'acknowledge-private-export']);
  if(Object.keys(args).some(k=>!accepted.has(k))||!args.state||!args.input)
    throw Error('Missing/unsupported video command option');
  const app=new LaunchwrightApplication(resolve(args.state));
  try{
    const input=privateJson(args.input,'Video source selection');
    if(verb==='plan'){
      if(!args.out)throw Error('A private --out JSON path is required');
      const plan=planVideoVariants(app,input);
      const dest=resolve(args.out);
      writeFileSync(dest,JSON.stringify(plan,null,2)+'\n',{flag:'wx',mode:0o600});
      print({schema_version:'launchwright-video-variants-plan-output/1',
        private_plan_saved:dest,plan_sha256:plan.plan_sha256,
        source_mp4_sha256:plan.source_mp4_sha256,
        captions_sha256:plan.captions_sha256,
        media_plan_digest:plan.media_plan_digest,
        source_technical_state:plan.source_technical_state,
        derivative_technical_state:'UNKNOWN',
        workspace_mutated:false,external_send_performed:false});
      return;
    }
    const plan=privateJson(args['plan-file'],'Saved video variants plan');
    if(!args['out-dir'])throw Error('A private output directory is required');
    const result=await exportVideoVariants(app,plan,input,resolve(args['out-dir']),{
      confirm_plan_sha256:args['confirm-plan'],
      confirm_source_mp4_sha256:args['confirm-source'],
      acknowledge_private_export:args['acknowledge-private-export']===true
    });
    print(result);
  }finally{app.close();}
}
main().catch(err=>{
  print({error:{code:err.code??'InvalidArgument',
    message:err.message??'Video variant operation failed',
    outcome_known:err.outcomeKnown??true}});
  process.exitCode=1;
});
