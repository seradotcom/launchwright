#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// R62 two-phase private caption burn-in against an exact Native/R46 source.
// No implicit external send or automatic approval/publication.
import { lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LaunchwrightApplication } from '../src/application.mjs';
import { planVideoCaptionBurnin, exportVideoCaptionBurnin } from '../src/video-caption-burnin.mjs';

const [action='help',...argv]=process.argv.slice(2);
const options=new Set(['state','r46-plan','r46-input','r46-dir','out',
  'burnin-plan','out-dir','confirm-plan','confirm-r46']);
const switches=new Set(['acknowledge-caption-review','acknowledge-privacy-unknown',
  'acknowledge-private-only','acknowledge-export']);
function parse(){
  const out={};
  for(let i=0;i<argv.length;i++){
    const raw=argv[i];
    if(!raw.startsWith('--')||Object.hasOwn(out,raw.slice(2)))
      throw Error('Unexpected or duplicate burn-in CLI option');
    const key=raw.slice(2);
    if(switches.has(key)){out[key]=true;continue;}
    if(!options.has(key)||!argv[i+1]||argv[i+1].startsWith('--'))
      throw Error('Missing or unsupported burn-in option --'+key);
    out[key]=argv[++i];
  }
  return out;
}
function privateJson(path,label){
  if(!path)throw Error('An operator-owned private '+label+' JSON path is required');
  const resolved=resolve(path),stat=lstatSync(resolved);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>64*1024||
    (process.platform!=='win32'&&(stat.mode&0o077)!==0))
    throw Error(label+' must be a regular private 0600 file, maximum 64 KiB');
  return JSON.parse(readFileSync(resolved,'utf8'));
}
function print(value){process.stdout.write(JSON.stringify(value,null,2)+'\n');}
async function main(){
  if(action==='help'){
    process.stdout.write(
      'Launchwright R62: reviewed Native/R46 WebVTT -> privately captioned landscape+portrait MP4s.\n'+
      ' plan --state DIR --r46-plan PRIVATE_R46_PLAN --r46-input PRIVATE_R46_INPUT \\\n'+
      '      --r46-dir PRIVATE_R46_OUTPUT --out PRIVATE_R62_PLAN \\\n'+
      '      --acknowledge-caption-review --acknowledge-privacy-unknown --acknowledge-private-only\n'+
      ' export --state DIR --r46-plan PRIVATE_R46_PLAN --r46-input PRIVATE_R46_INPUT \\\n'+
      '        --r46-dir PRIVATE_R46_OUTPUT --burnin-plan PRIVATE_R62_PLAN \\\n'+
      '        --out-dir EXISTING_PRIVATE_0700_DIR --confirm-plan R62_SHA256 \\\n'+
      '        --confirm-r46 R46_ZIP_SHA256 --acknowledge-export\n'+
      ' No customer-source execution, alternate voice, original timeline rewrite, Platform or publication.\n'
    );return;
  }
  if(!['plan','export'].includes(action))throw Error('Unknown caption burn-in CLI action');
  const o=parse();
  const allowed=action==='plan'?
    ['state','r46-plan','r46-input','r46-dir','out',
      'acknowledge-caption-review','acknowledge-privacy-unknown','acknowledge-private-only']:
    ['state','r46-plan','r46-input','r46-dir','burnin-plan','out-dir',
      'confirm-plan','confirm-r46','acknowledge-export'];
  if(Object.keys(o).some(k=>!allowed.includes(k))||!o.state||!o['r46-dir'])
    throw Error('Caption command requires an explicit owner workspace and original R46 source');
  const app=new LaunchwrightApplication(resolve(o.state));
  try{
    const selection={
      r46_plan:privateJson(o['r46-plan'],'R46 plan'),
      r46_input:privateJson(o['r46-input'],'R46 source selection'),
      r46_dir:resolve(o['r46-dir']),
      acknowledge_caption_review:true,
      acknowledge_video_privacy_unknown:true,
      acknowledge_private_only:true
    };
    if(action==='plan'){
      if(!o.out)throw Error('A private --out plan path is required');
      selection.acknowledge_caption_review=o['acknowledge-caption-review']===true;
      selection.acknowledge_video_privacy_unknown=o['acknowledge-privacy-unknown']===true;
      selection.acknowledge_private_only=o['acknowledge-private-only']===true;
      const plan=await planVideoCaptionBurnin(app,selection);
      writeFileSync(resolve(o.out),JSON.stringify(plan,null,2)+'\n',{
        mode:0o600,flag:'wx'
      });
      print({private_plan_saved:resolve(o.out),
        plan_sha256:plan.plan_sha256,
        exact_r46_zip_sha256:plan.r46_zip_sha256,
        media_plan_digest:plan.media_plan_digest,
        cue_count:plan.cue_count,
        technical_state:'UNKNOWN',mutation_performed:false,
        publication_authority:false});
      return;
    }
    if(!o['out-dir'])throw Error('An explicitly selected private output directory is required');
    const plan=privateJson(o['burnin-plan'],'R62 burn-in plan');
    print(await exportVideoCaptionBurnin(app,plan,selection,resolve(o['out-dir']),{
      confirm_plan_sha256:o['confirm-plan'],
      confirm_r46_zip_sha256:o['confirm-r46'],
      acknowledge_private_export:o['acknowledge-export']===true
    }));
  }finally{app.close();}
}
main().catch(err=>{
  print({error:{
    code:err.code??'InvalidArgument',
    message:err instanceof Error?err.message:'Caption burn-in rejected',
    outcome_known:err.outcomeKnown??true
  }});
  process.exitCode=1;
});
