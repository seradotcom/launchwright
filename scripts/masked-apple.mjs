#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// R58 operator-controlled mask-source Apple screenshots. The canonical
// R55, R44, and R51 layers remain owners of all underlying operations.
import { existsSync,lstatSync,readFileSync,writeFileSync } from 'node:fs';
import { resolve,join } from 'node:path';
import { LaunchwrightApplication } from '../src/application.mjs';
import { planMaskedApple,verifyMaskedApple,exportMaskedApple,
  prepareMaskedAppleUpload,sendMaskedAppleUpload } from '../src/masked-apple-handoff.mjs';
import { createAppleScreenshotTransport } from '../src/apple-screenshot-http.mjs';
const [command='help',...tokens]=process.argv.slice(2);
const options=new Set([
  'state','bundle','plan','out','out-dir','screenshot-set','localization',
  'intent','token-file','confirm-masked','confirm-store','confirm-candidate',
  'confirm-apple-intent','confirm-set'
]);
const switches=new Set([
  'acknowledge-private-export','acknowledge-remaining-privacy-unknown',
  'acknowledge-asset-only','acknowledge-first-send'
]);
function parse(){
  const o={};
  for(let i=0;i<tokens.length;i++){
    const key=tokens[i];
    if(!key.startsWith('--')||Object.hasOwn(o,key))throw Error('Duplicate/unexpected option');
    const field=key.slice(2);
    if(switches.has(field)){o[field]=true;continue;}
    if(!options.has(field)||!tokens[i+1]||tokens[i+1].startsWith('--'))
      throw Error('Unsupported/missing R58 option --'+field);
    o[field]=tokens[++i];
  }
  return o;
}
function select(input,allowed){
  if(Object.keys(input).some(k=>!allowed.includes(k)))
    throw Error('R58 command contains unsupported options');
}
function readPrivate(path,max=128*1024){
  if(!path)throw Error('A private input file is required');
  const file=resolve(path),stat=lstatSync(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size<=1||stat.size>max||
    (process.platform!=='win32'&&(stat.mode&0o077)!==0))
    throw Error('R58 JSON input must be a private 0600 regular file within byte limit');
  return JSON.parse(readFileSync(file,'utf8'));
}
function save(file,data){
  if(!file)throw Error('An explicit private output JSON filename is required');
  writeFileSync(resolve(file),JSON.stringify(data,null,2)+'\n',{
    flag:'wx',mode:0o600
  });
}
const print=x=>process.stdout.write(JSON.stringify(x,null,2)+'\n');
async function main(){
  if(command==='help'){
    process.stdout.write(
      'R58 R55 mask -> Native derivative -> R44 Apple screenshots -> R51 existing screenshot set.\n'+
      ' plan --state DIR --bundle PRIVATE_R58_JSON --out PRIVATE_PLAN\n'+
      ' export --state DIR --bundle PRIVATE_R58_JSON --plan PRIVATE_PLAN --out-dir PRIVATE_0700_DIR --confirm-masked MASK_PLAN_SHA --confirm-store STORE_PLAN_SHA --confirm-candidate CANDIDATE_SHA --acknowledge-private-export --acknowledge-remaining-privacy-unknown\n'+
      ' apple-plan --state DIR --bundle PRIVATE_R58_JSON --plan PRIVATE_PLAN --out-dir PRIVATE_0700_DIR --screenshot-set ID --localization ID --out PRIVATE_APPLE_INTENT --acknowledge-asset-only\n'+
      ' send|recover --state DIR --bundle PRIVATE_R58_JSON --plan PRIVATE_PLAN --out-dir PRIVATE_0700_DIR --intent PRIVATE_APPLE_INTENT --token-file PRIVATE_APPLE_JWT --confirm-masked MASK_PLAN_SHA --confirm-apple-intent APPLE_INTENT_SHA --confirm-candidate CANDIDATE_SHA --confirm-set SCREENSHOT_SET_ID [--acknowledge-first-send] [--out PRIVATE_RECEIPT]\n'+
      ' Never submits for App Review, commits changes, or certifies global pixel privacy.\n'
    );return;
  }
  const accepted=['plan','export','apple-plan','send','recover'];
  if(!accepted.includes(command))throw Error('Unknown masked Apple action');
  const o=parse();
  const common=['state','bundle','plan','out','out-dir'];
  const only=command==='plan'?['state','bundle','out']:
    command==='export'?[...common,'confirm-masked','confirm-store','confirm-candidate',
      'acknowledge-private-export','acknowledge-remaining-privacy-unknown']:
    command==='apple-plan'?[...common,'screenshot-set','localization','acknowledge-asset-only']:
    [...common,'intent','token-file','confirm-masked','confirm-apple-intent',
      'confirm-candidate','confirm-set','acknowledge-first-send'];
  select(o,only);
  if(!o.state||!o.bundle)throw Error('Existing workspace and private R55/R44 bundle are required');
  if((command==='send'||command==='recover')&&o.out&&existsSync(resolve(o.out)))
    throw Error('An existing private remote receipt must never be overwritten or cause blind retry');
  if(command==='recover'&&o['acknowledge-first-send'])
    throw Error('Read-only recover can never acknowledge a remote send');
  const app=new LaunchwrightApplication(resolve(o.state));
  try{
    const raw=readPrivate(o.bundle);
    if(command==='plan'){
      const plan=planMaskedApple(app,raw);
      save(o.out,plan);
      print({plan_sha256:plan.plan_sha256,
        store_plan_sha256:plan.store_plan_sha256,
        candidate_sha256:plan.candidate_sha256,
        screenshots:plan.screenshot_count,technical_state:'UNKNOWN',
        private_plan_written:true,remote_actions_performed:false});
      return;
    }
    const plan=readPrivate(o.plan);
    verifyMaskedApple(app,plan,raw);
    if(command==='export'){
      const result=await exportMaskedApple(app,plan,raw,resolve(o['out-dir']),{
        confirm_masked_plan_sha256:o['confirm-masked'],
        confirm_store_plan_sha256:o['confirm-store'],
        confirm_candidate_sha256:o['confirm-candidate'],
        acknowledge_private_export:o['acknowledge-private-export']===true,
        acknowledge_remaining_privacy_unknown:
          o['acknowledge-remaining-privacy-unknown']===true
      });
      print(result);return;
    }
    const receiptFile=join(resolve(o['out-dir']),
      'launchwright-masked-apple-'+plan.plan_sha256.slice(0,12)+'.receipt.json');
    const proof=readPrivate(receiptFile);
    if(command==='apple-plan'){
      if(o['acknowledge-asset-only']!==true)
        throw Error('Operator must acknowledge Apple asset-only scope');
      const intent=await prepareMaskedAppleUpload(app,plan,raw,
        resolve(o['out-dir']),proof,{
          screenshot_set_id:o['screenshot-set'],
          localization_id:o.localization,
          screenshot_display_type:'APP_IPHONE_61',
          acknowledge_asset_only:true
        });
      save(o.out,intent);
      print({saved_intent:resolve(o.out),
        masked_plan_sha256:plan.plan_sha256,
        apple_intent_sha256:intent.apple_intent.intent_sha256,
        screenshot_count:intent.apple_intent.screenshot_count,
        remote_actions_performed:false,technical_state:'UNKNOWN'});
      return;
    }
    if(!o['token-file']||!o.intent||!o['out-dir'])
      throw Error('Private Apple JWT, exact R58 intent and output directory are required');
    const intent=readPrivate(o.intent);
    const remote=createAppleScreenshotTransport({
      token_file:resolve(o['token-file'])
    });
    const result=await sendMaskedAppleUpload(app,plan,raw,
      resolve(o['out-dir']),proof,intent,remote,{
        confirm_masked_plan_sha256:o['confirm-masked'],
        confirm_intent_sha256:o['confirm-apple-intent'],
        confirm_candidate_sha256:o['confirm-candidate'],
        confirm_screenshot_set_id:o['confirm-set'],
        recover_only:command==='recover',
        acknowledge_first_remote_write:command==='send'&&
          o['acknowledge-first-send']===true
      });
    if(o.out)save(o.out,result);
    print(result);
  }finally{app.close();}
}
main().catch(error=>{
  print({error:{code:error.code??'InvalidArgument',
    message:error.message,outcome_known:error.outcomeKnown??false}});
  process.exitCode=1;
});
