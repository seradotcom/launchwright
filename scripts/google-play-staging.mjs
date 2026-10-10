#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// R52: operator-supplied Google Play EXISTING Edit; only images upload.
// A DRAFT, UNCOMMITTED Edit never equals a published app-store listing.
import { existsSync,lstatSync,readFileSync,writeFileSync } from 'node:fs';
import { dirname,resolve } from 'node:path';
import { LaunchwrightApplication } from '../src/application.mjs';
import { prepareGooglePlayStaging,sendGooglePlayStaging }
  from '../src/google-play-staging.mjs';
import { createGooglePlayTransport } from '../src/google-play-http.mjs';

const [command='help',...args]=process.argv.slice(2);
const scalar=new Set(['state','store-plan','source-input','store-zip','package-name',
  'edit-id','out','intent','token-file','confirm-intent','confirm-store-plan',
  'confirm-package','confirm-edit']);
const flags=new Set(['acknowledge-uncommitted','acknowledge-first-upload']);
function parse(){
  const found={};
  for(let i=0;i<args.length;i++){
    const key=args[i];
    if(!key.startsWith('--')||Object.hasOwn(found,key))
      throw Error('Duplicate or unsupported Google Play CLI argument');
    const label=key.slice(2);
    if(flags.has(label)){found[label]=true;continue;}
    if(!scalar.has(label)||!args[i+1]||args[i+1].startsWith('--'))
      throw Error('Unknown or missing Google Play argument '+label);
    found[label]=args[++i];
  }
  return found;
}
function only(values,keys){
  if(Object.keys(values).some(k=>!keys.includes(k)))
    throw Error('Google Play command has unsupported options or wrong phase');
}
function privateJson(path,max,label){
  if(!path)throw Error('Choose the private '+label+' JSON file');
  const file=resolve(path),stat=lstatSync(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size<2||stat.size>max||
    (process.platform!=='win32'&&(stat.mode&0o077)!==0))
    throw Error(label+' is not a private regular JSON (0600 on POSIX)');
  return JSON.parse(readFileSync(file,'utf8'));
}
function outputPath(path){
  if(!path)throw Error('An explicit private output receipt path is required');
  const file=resolve(path),dir=dirname(file),st=lstatSync(dir);
  if(!st.isDirectory()||st.isSymbolicLink()||
    (process.platform!=='win32'&&(st.mode&0o077)!==0))
    throw Error('Output parent must be an existing private 0700 folder');
  if(existsSync(file))throw Error('The private output already exists; never overwrite an intent/receipt');
  return file;
}
const emit=value=>process.stdout.write(JSON.stringify(value,null,2)+'\n');
async function main(){
  if(command==='help'){
    process.stdout.write(
      'R52 Google Play provisional images for an EXISTING operator-owned Edit. No edits.insert, commit, delete or public listing.\n'+
      ' plan --state DIR --source-input PRIVATE_R44_JSON --store-plan PRIVATE_R44_PLAN --store-zip PRIVATE_R44_ZIP --package-name APP.ID --edit-id EXISTING_EDIT_ID --out PRIVATE_INTENT --acknowledge-uncommitted\n'+
      ' send --state DIR --source-input PRIVATE_R44_JSON --store-plan PRIVATE_R44_PLAN --store-zip PRIVATE_R44_ZIP --intent PRIVATE_INTENT --token-file PRIVATE_OAUTH_TOKEN --confirm-intent SHA256 --confirm-store-plan SHA256 --confirm-package APP.ID --confirm-edit ID --out PRIVATE_RECEIPT --acknowledge-first-upload\n'+
      ' recover --state DIR --source-input PRIVATE_R44_JSON --store-plan PRIVATE_R44_PLAN --store-zip PRIVATE_R44_ZIP --intent PRIVATE_INTENT --token-file PRIVATE_OAUTH_TOKEN --confirm-intent SHA256 --confirm-store-plan SHA256 --confirm-package APP.ID --confirm-edit ID --out PRIVATE_RECEIPT\n'+
      ' Recovery is READ-ONLY. If an upload outcome is unknown, NEVER issue send again.\n'
    );return;
  }
  if(!['plan','send','recover'].includes(command))
    throw Error('Unknown Google Play staging command');
  const input=parse();
  const planning=['state','source-input','store-plan','store-zip','package-name',
    'edit-id','out','acknowledge-uncommitted'];
  const sending=['state','source-input','store-plan','store-zip','intent','token-file',
    'confirm-intent','confirm-store-plan','confirm-package','confirm-edit','out'];
  only(input,command==='plan'?planning:
    command==='send'?[...sending,'acknowledge-first-upload']:sending);
  if(!input.state||!input['source-input']||!input['store-plan']||!input['store-zip'])
    throw Error('Local source workspace and exact R44 bundle are required');
  const file=outputPath(input.out);
  const storeInput=privateJson(input['source-input'],128*1024,'R44 source selection');
  const storePlan=privateJson(input['store-plan'],64*1024,'R44 approved plan');
  const app=new LaunchwrightApplication(resolve(input.state));
  try{
    if(command==='plan'){
      const intent=await prepareGooglePlayStaging(app,storePlan,storeInput,
        resolve(input['store-zip']),{
          package_name:input['package-name'],edit_id:input['edit-id'],
          acknowledge_uncommitted_only:input['acknowledge-uncommitted']===true
        });
      writeFileSync(file,JSON.stringify(intent,null,2)+'\n',{flag:'wx',mode:0o600});
      emit({saved_private_intent:file,intent_sha256:intent.intent_sha256,
        existing_edit_id:intent.edit_id,package_name:intent.package_name,
        approved_assets:intent.assets.length,
        remote_mutations_performed:false,published:false,
        platform_authority:false});
      return;
    }
    const intent=privateJson(input.intent,64*1024,'R52 Google Play intent');
    const remote=createGooglePlayTransport({accessTokenFile:resolve(input['token-file'])});
    const result=await sendGooglePlayStaging(app,storePlan,storeInput,
      resolve(input['store-zip']),intent,remote,{
        confirm_intent_sha256:input['confirm-intent'],
        confirm_store_plan_sha256:input['confirm-store-plan'],
        confirm_package_name:input['confirm-package'],
        confirm_edit_id:input['confirm-edit'],
        recover_only:command==='recover',
        acknowledge_first_upload:command==='send'&&
          input['acknowledge-first-upload']===true
      });
    writeFileSync(file,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
    emit(result);
  }finally{app.close();}
}
main().catch(error=>{
  emit({error:{code:error.code??'InvalidArgument',
    message:error.message,outcome_known:error.outcomeKnown??true}});
  process.exitCode=1;
});
