#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// R56 two-phase private R55 mask receipts -> R44 Google Play listing pack.
// Real operator local files only; never creates/commits a Google Play Edit.
import { readFileSync,lstatSync,writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LaunchwrightApplication } from '../src/application.mjs';
import { planMaskedStore,exportMaskedStore } from '../src/masked-store-handoff.mjs';

const [verb='help',...argv]=process.argv.slice(2);
const allowed=new Set(['state','input','plan','out','out-dir',
  'confirm-handoff','confirm-store','confirm-candidate']);
const switches=new Set([
  'acknowledge-private-export','acknowledge-remaining-privacy-unknown'
]);
function parse(){
  const fields={};
  for(let i=0;i<argv.length;i++){
    const flag=argv[i];
    if(!flag.startsWith('--')||Object.hasOwn(fields,flag.slice(2)))
      throw Error('Invalid or duplicate masked store argument');
    const key=flag.slice(2);
    if(switches.has(key)){fields[key]=true;continue;}
    if(!allowed.has(key)||!argv[i+1]||argv[i+1].startsWith('--'))
      throw Error('Unsupported or missing masked store option: '+key);
    fields[key]=argv[++i];
  }
  return fields;
}
function ownedJson(path,label,maxBytes){
  if(!path)throw Error(label+' private file is required');
  const p=resolve(path),st=lstatSync(p);
  if(!st.isFile()||st.isSymbolicLink()||st.size>maxBytes||
    (process.platform!=='win32'&&(st.mode&0o077)!==0))
    throw Error(label+' must be a private regular 0600 JSON file within its byte budget');
  return JSON.parse(readFileSync(p,'utf8'));
}
const print=x=>process.stdout.write(JSON.stringify(x,null,2)+'\n');
async function main(){
  if(verb==='help'){
    process.stdout.write(
      'R56: exact R55 manually masked PNG + Native Evidence to R44 Google Play phone assets\n'+
      ' plan --state DIR --input PRIVATE_MASKED_INPUT_JSON --out PRIVATE_PLAN_JSON\n'+
      ' export --state DIR --input PRIVATE_MASKED_INPUT_JSON --plan PRIVATE_PLAN_JSON\n'+
      '        --out-dir PRIVATE_0700_DIR --confirm-handoff SHA256 --confirm-store SHA256\n'+
      '        --confirm-candidate SHA256 --acknowledge-private-export\n'+
      '        --acknowledge-remaining-privacy-unknown\n'+
      'No Play Edit, account upload, PII certification, app binary or publication is performed.\n'
    );return;
  }
  if(!['plan','export'].includes(verb))throw Error('Unknown masked store command');
  const values=parse();
  const accepted=verb==='plan'
    ? ['state','input','out']
    : ['state','input','plan','out-dir','confirm-handoff','confirm-store',
      'confirm-candidate','acknowledge-private-export',
      'acknowledge-remaining-privacy-unknown'];
  if(!values.state||Object.keys(values).some(k=>!accepted.includes(k)))
    throw Error('Masked store command has missing or unapproved arguments');
  const app=new LaunchwrightApplication(resolve(values.state));
  try{
    const source=ownedJson(values.input,'R55/R44 private handoff input',512*1024);
    if(verb==='plan'){
      if(!values.out)throw Error('Explicit --out file required for private plan');
      const plan=planMaskedStore(app,source);
      writeFileSync(resolve(values.out),JSON.stringify(plan,null,2)+'\n',{
        mode:0o600,flag:'wx'
      });
      print({
        schema_version:'launchwright-masked-store-cli-plan/1',
        saved_plan:resolve(values.out),
        plan_sha256:plan.plan_sha256,
        store_plan_sha256:plan.store_plan_sha256,
        candidate_sha256:plan.candidate_sha256,
        screenshot_count:plan.screenshot_count,
        technical_state:'UNKNOWN',
        workspace_mutated:false,external_network_accessed:false,
        google_edit_mutated:false
      });
      return;
    }
    if(!values['out-dir'])throw Error('Private --out-dir required');
    const plan=ownedJson(values.plan,'R56 private plan',128*1024);
    const receipt=await exportMaskedStore(app,plan,source,resolve(values['out-dir']),{
      confirm_handoff_sha256:values['confirm-handoff'],
      confirm_store_plan_sha256:values['confirm-store'],
      confirm_candidate_sha256:values['confirm-candidate'],
      acknowledge_private_export:values['acknowledge-private-export']===true,
      acknowledge_remaining_privacy_unknown:
        values['acknowledge-remaining-privacy-unknown']===true
    });
    print(receipt);
  }finally{app.close();}
}
main().catch(err=>{
  print({error:{
    code:err.code??'InvalidArgument',
    message:err.message,
    outcome_known:err.outcomeKnown??true
  }});
  process.exitCode=1;
});
