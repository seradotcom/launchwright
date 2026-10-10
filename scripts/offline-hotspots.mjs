#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// R61: explicit private plan/apply for R55/R59 source-bound offline click-through.
// Only the operator's local files are read/written; no source scripts/network.
import { lstatSync,readFileSync,writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LaunchwrightApplication } from '../src/application.mjs';
import { planOfflineHotspots,exportOfflineHotspots } from '../src/offline-hotspots.mjs';

const [command='help',...args]=process.argv.slice(2);
const valued=new Set(['state','r59-plan','r59-request','r59-dir','links','plan',
  'out','out-dir','confirm-plan','confirm-r59']);
const switches=new Set(['acknowledge-private-only','acknowledge-mask-scope-only',
  'acknowledge-private-export','acknowledge-privacy-outside-masks-unknown']);
function parse(){
  const options={};
  for(let i=0;i<args.length;i++){
    const a=args[i];
    if(!a.startsWith('--')||Object.hasOwn(options,a.slice(2)))
      throw Error('Unexpected or duplicated operator option');
    const key=a.slice(2);
    if(switches.has(key)){options[key]=true;continue;}
    if(!valued.has(key)||!args[i+1]||args[i+1].startsWith('--'))
      throw Error('Missing or unsupported --'+key);
    options[key]=args[++i];
  }
  return options;
}
const print=value=>process.stdout.write(JSON.stringify(value,null,2)+'\n');
function privateJSON(filename,label,max=384*1024){
  if(!filename)throw Error(label+' private JSON path required');
  const path=resolve(filename),stat=lstatSync(path);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size<2||stat.size>max||
    (process.platform!=='win32'&&(stat.mode&0o077)!==0))
    throw Error(label+' must be a private 0600 regular JSON file, within size budget');
  return JSON.parse(readFileSync(path,'utf8'));
}
async function main(){
  if(command==='help'){
    process.stdout.write(
      'R61 static click-through using R59 exact R55-masked/Native Media ZIP.\n'+
      ' plan --state PRIVATE_WORKSPACE --r59-plan R59_PRIVATE_JSON --r59-request R59_PRIVATE_JSON --r59-dir R59_PRIVATE_OUTPUT_DIR --links HOTSPOTS_PRIVATE_JSON --out NEW_PRIVATE_PLAN --acknowledge-mask-scope-only --acknowledge-private-only\n'+
      ' export --state PRIVATE_WORKSPACE --r59-plan R59_PRIVATE_JSON --r59-request R59_PRIVATE_JSON --r59-dir R59_PRIVATE_OUTPUT_DIR --links HOTSPOTS_PRIVATE_JSON --plan SAVED_R61_PRIVATE_PLAN --out-dir PRIVATE_OUTPUT_DIR --confirm-plan R61_SHA256 --confirm-r59 ORIGINAL_ZIP_SHA256 --acknowledge-mask-scope-only --acknowledge-private-only --acknowledge-private-export --acknowledge-privacy-outside-masks-unknown\n'+
      ' Each hotspot coordinates are ORIGINAL screenshot pixels, not CSS pixels.\n'+
      ' Offline links merely switch masked screenshots. No customer app execution, scripts, network or publication.\n'
    );return;
  }
  if(!['plan','export'].includes(command))throw Error('Unsupported offline demo command');
  const options=parse();
  const allowed=command==='plan'
    ? ['state','r59-plan','r59-request','r59-dir','links','out',
       'acknowledge-mask-scope-only','acknowledge-private-only']
    : ['state','r59-plan','r59-request','r59-dir','links','plan','out-dir',
       'confirm-plan','confirm-r59','acknowledge-mask-scope-only',
       'acknowledge-private-only','acknowledge-private-export',
       'acknowledge-privacy-outside-masks-unknown'];
  if(Object.keys(options).some(k=>!allowed.includes(k))||!options.state)
    throw Error('Operator command has missing or unsupported parameters');
  const app=new LaunchwrightApplication(resolve(options.state));
  try{
    const params={
      masked_plan:privateJSON(options['r59-plan'],'R59 plan',64*1024),
      masked_request:privateJSON(options['r59-request'],'R59 full source request'),
      source_dir:resolve(options['r59-dir']??''),
      links:privateJSON(options.links,'Hotspot geometry',32*1024),
      acknowledge_mask_scope_only:options['acknowledge-mask-scope-only']===true,
      acknowledge_private_only:options['acknowledge-private-only']===true
    };
    if(command==='plan'){
      if(!options.out)throw Error('An exclusive private --out plan path is required');
      const plan=await planOfflineHotspots(app,params);
      const file=resolve(options.out);
      writeFileSync(file,JSON.stringify(plan,null,2)+'\n',{
        mode:0o600,flag:'wx'
      });
      print({saved_plan:file,plan_sha256:plan.plan_sha256,
        r59_bundle_sha256:plan.r59_bundle_sha256,
        native_media_output_id:plan.r59_media_output_id,
        hotspot_count:plan.links.length,workspace_mutated:false,
        technical_state:'UNKNOWN',private_only:true});
      return;
    }
    if(!options['out-dir'])throw Error('Private --out-dir is required');
    const plan=privateJSON(options.plan,'Saved R61 plan',32*1024);
    const receipt=await exportOfflineHotspots(app,plan,params,resolve(options['out-dir']),{
      confirm_plan_sha256:options['confirm-plan'],
      confirm_r59_bundle_sha256:options['confirm-r59'],
      acknowledge_private_export:options['acknowledge-private-export']===true,
      acknowledge_privacy_outside_masks_unknown:
        options['acknowledge-privacy-outside-masks-unknown']===true
    });
    print(receipt);
  }finally{app.close();}
}
main().catch(err=>{
  print({error:{code:err.code??'InvalidArgument',message:err.message,
    outcome_known:err.outcomeKnown??true}});
  process.exitCode=1;
});
