#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// R51: two-phase Apple screenshot reservations from private R44 package.
// No app review submission, pricing, app binary, account creation or Publish.
import { readFileSync,lstatSync,writeFileSync,existsSync,openSync,closeSync,unlinkSync } from 'node:fs';
import { resolve,join } from 'node:path';
import { LaunchwrightApplication } from '../src/application.mjs';
import { prepareAppleScreenshotUpload,sendAppleScreenshotUpload }
  from '../src/apple-screenshot-upload.mjs';
import { createAppleScreenshotTransport } from '../src/apple-screenshot-http.mjs';

const [command='help',...argv]=process.argv.slice(2);
const valued=new Set([
  'state','store-plan','store-input','store-zip',
  'screenshot-set-id','localization-id','display-type','out',
  'intent','token-file','confirm-intent','confirm-candidate','confirm-set'
]);
const switches=new Set(['acknowledge-asset-only','acknowledge-first-send']);
const print=v=>process.stdout.write(JSON.stringify(v,null,2)+'\n');
function args(){
  const out={};
  for(let i=0;i<argv.length;i++){
    if(!argv[i].startsWith('--'))throw Error('Unexpected positional argument');
    const key=argv[i].slice(2);
    if(Object.hasOwn(out,key))throw Error('Duplicate Apple operator argument');
    if(switches.has(key)){out[key]=true;continue;}
    if(!valued.has(key)||!argv[i+1]||argv[i+1].startsWith('--'))
      throw Error('Unsupported/missing Apple operator argument');
    out[key]=argv[++i];
  }
  return out;
}
function privateJson(path,max,label){
  if(!path)throw Error('Select private '+label+' JSON path');
  const file=resolve(path),stat=lstatSync(file);
  if(!stat.isFile()||stat.isSymbolicLink()||
    stat.size<2||stat.size>max||
    (process.platform!=='win32'&&(stat.mode&0o077)!==0))
    throw Error(label+' must be a private regular 0600 JSON file within '+max+' bytes');
  return JSON.parse(readFileSync(file,'utf8'));
}
async function main(){
  if(command==='help'){
    console.log('R51 Apple App Store Connect screenshot assets for an existing screenshot set only.\n'+
      ' plan --state DIR --store-input PRIVATE_R44_INPUT --store-plan PRIVATE_R44_PLAN'+
      ' --store-zip PRIVATE_R44_ZIP --screenshot-set-id EXISTING_ID'+
      ' --localization-id EXISTING_ID --out PRIVATE_INTENT'+
      ' --acknowledge-asset-only\n'+
      ' send --state DIR --store-input ... --store-plan ... --store-zip ...'+
      ' --intent PRIVATE_INTENT --token-file PRIVATE_JWT'+
      ' --confirm-intent INTENT_SHA256 --confirm-candidate CANDIDATE_SHA256'+
      ' --confirm-set EXISTING_ID --acknowledge-first-send [--out PRIVATE_RECEIPT]\n'+
      ' recover --state DIR --store-input ... --store-plan ... --store-zip ...'+
      ' --intent PRIVATE_INTENT --token-file PRIVATE_JWT'+
      ' --confirm-intent INTENT_SHA256 --confirm-candidate CANDIDATE_SHA256'+
      ' --confirm-set EXISTING_ID [--out PRIVATE_RECEIPT]\n'+
      ' No Apple app review submission or storefront publication exists in this CLI.');
    return;
  }
  if(!['plan','send','recover'].includes(command))throw Error('Unsupported Apple action');
  const a=args();
  const basic=['state','store-input','store-plan','store-zip'];
  const authorized=command==='plan'?
    [...basic,'screenshot-set-id','localization-id','display-type','out',
      'acknowledge-asset-only']:
    [...basic,'intent','token-file','confirm-intent','confirm-candidate',
      'confirm-set','out','acknowledge-first-send'];
  if(Object.keys(a).some(k=>!authorized.includes(k))||
    basic.some(k=>!a[k])||!a.state)
    throw Error('An Apple screenshot command has unsupported/missing options');
  const app=new LaunchwrightApplication(resolve(a.state));
  try{
    const source=privateJson(a['store-input'],128*1024,'R44 source selection');
    const plan=privateJson(a['store-plan'],128*1024,'R44 reviewed source plan');
    if(command==='plan'){
      if(!a.out)throw Error('Private Apple intent output path is required');
      const intent=await prepareAppleScreenshotUpload(app,plan,source,
        resolve(a['store-zip']),{
          screenshot_set_id:a['screenshot-set-id'],
          localization_id:a['localization-id'],
          screenshot_display_type:a['display-type']??'APP_IPHONE_61',
          acknowledge_asset_only:a['acknowledge-asset-only']===true
        });
      writeFileSync(resolve(a.out),JSON.stringify(intent,null,2)+'\n',
        {mode:0o600,flag:'wx'});
      print({private_intent_saved:resolve(a.out),
        intent_sha256:intent.intent_sha256,
        screenshot_set_id:intent.screenshot_set_id,
        screenshots:intent.screenshot_count,
        remote_mutations_performed:false,app_submitted:false,
        published:false});
      return;
    }
    if(!a.intent||!a['token-file'])throw Error('Original private intent and JWT token file are required');
    if(command==='recover'&&a['acknowledge-first-send'])
      throw Error('Recover-only must never consent to a remote write');
    if(a.out&&existsSync(resolve(a.out)))
      throw Error('Receipt file already exists; it cannot be overwritten');
    const intent=privateJson(a.intent,32*1024,'Apple screenshot intent');
    const remote=createAppleScreenshotTransport({
      token_file:resolve(a['token-file'])
    });
    const lock=join(app.store.root,'.apple-screenshot-send.lock');
    let fd=null;
    try{
      fd=openSync(lock,'wx',0o600);
      const result=await sendAppleScreenshotUpload(app,plan,source,
        resolve(a['store-zip']),intent,remote,{
          confirm_intent_sha256:a['confirm-intent'],
          confirm_candidate_sha256:a['confirm-candidate'],
          confirm_screenshot_set_id:a['confirm-set'],
          acknowledge_first_remote_write:command==='send'&&a['acknowledge-first-send']===true,
          recover_only:command==='recover'
        });
      if(a.out)writeFileSync(resolve(a.out),JSON.stringify(result,null,2)+'\n',
        {mode:0o600,flag:'wx'});
      print(result);
    }finally{
      if(fd!==null){try{closeSync(fd);}finally{unlinkSync(lock);}}
    }
  }finally{app.close();}
}
main().catch(err=>{
  // Never print API credentials, signed URLs, HTTP response bodies or JWTs.
  print({error:{code:err.code??'InvalidArgument',
    message:err.message,outcome_known:err.outcomeKnown??false}});
  process.exitCode=1;
});
