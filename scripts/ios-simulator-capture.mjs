#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// R49 operator-owned local iPhone Simulator screenshot. Never installs,
// boots, launches, builds or executes an application.
import { resolve } from 'node:path';
import { lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { LaunchwrightApplication } from '../src/application.mjs';
import {
  planIOSSimulator,captureIOSSimulator
} from '../src/ios-simulator-capture.mjs';

const [verb='help',...raw]=process.argv.slice(2);
const fields=new Set(['state','release','target','source','udid','bundle',
  'rights','out','plan','out-dir','confirm-plan','confirm-bundle','confirm-build']);
const checks=new Set([
  'simulator-only','imported-unknown','approve-current-screen',
  'acknowledge-foreground-unknown','acknowledge-pixel-privacy'
]);
const echo=value=>process.stdout.write(JSON.stringify(value,null,2)+'\n');
function argumentsForVerb(){
  const values={};
  for(let i=0;i<raw.length;i++){
    const token=raw[i];
    if(!token.startsWith('--')||Object.hasOwn(values,token.slice(2)))
      throw Error('Unexpected duplicate or positional iOS simulator argument');
    const key=token.slice(2);
    if(checks.has(key)){values[key]=true;continue;}
    if(!fields.has(key)||!raw[i+1]||raw[i+1].startsWith('--'))
      throw Error('Missing/unsupported iOS simulator argument: '+key);
    values[key]=raw[++i];
  }
  const admitted=new Set(verb==='plan'
    ? ['state','release','target','source','udid','bundle','rights','out',
       'simulator-only','imported-unknown']
    : ['state','plan','out-dir','confirm-plan','confirm-bundle','confirm-build',
       'approve-current-screen','acknowledge-foreground-unknown',
       'acknowledge-pixel-privacy']);
  if(Object.keys(values).some(k=>!admitted.has(k)))
    throw Error('The selected iOS action has unsupported options');
  return values;
}
function privatePlan(filename){
  if(!filename)throw Error('Original private saved iOS plan is required');
  const filenameResolved=resolve(filename),st=lstatSync(filenameResolved);
  if(!st.isFile()||st.isSymbolicLink()||st.size>16*1024||
     (process.platform!=='win32'&&(st.mode&0o077)!==0))
    throw Error('iOS plan must be a private regular JSON file (0600), max 16 KiB');
  return JSON.parse(readFileSync(filenameResolved,'utf8'));
}
async function main(){
  if(verb==='help'){
    process.stdout.write(
      'R49 owner-only: observe a manually booted local iPhone Simulator and import UNKNOWN screenshot.\n'+
      ' plan --state DIR --release ID --target ID --source ID --udid SIMULATOR_UUID --bundle BUNDLE_ID --rights owned|licensed --out PRIVATE_JSON --simulator-only --imported-unknown\n'+
      ' capture --state DIR --plan PRIVATE_JSON --out-dir PRIVATE_0700_DIR --confirm-plan FULL_SHA256 --confirm-bundle BUNDLE_ID --confirm-build LABEL --approve-current-screen --acknowledge-foreground-unknown --acknowledge-pixel-privacy\n'+
      'Manually install and foreground the authorized app. This adapter never launches, installs, boots or publishes anything.\n'
    );return;
  }
  if(!['plan','capture'].includes(verb))throw Error('Unsupported iOS action');
  const flags=argumentsForVerb();
  if(!flags.state)throw Error('An existing operator workspace is required');
  const app=new LaunchwrightApplication(resolve(flags.state));
  try{
    if(verb==='plan'){
      if(!flags.out)throw Error('A private --out JSON file is required');
      const plan=planIOSSimulator(app,{
        release_id:flags.release,source_id:flags.source,
        target_id:flags.target,udid:flags.udid,bundle_id:flags.bundle,
        rights:flags.rights,
        acknowledge_simulator_only:flags['simulator-only']===true,
        acknowledge_unknown:flags['imported-unknown']===true
      });
      writeFileSync(resolve(flags.out),JSON.stringify(plan,null,2)+'\n',
        {flag:'wx',mode:0o600});
      echo({private_plan_saved:resolve(flags.out),
        plan_sha256:plan.plan_sha256,device:plan.simulator.device_name,
        runtime:plan.simulator.runtime,source_build_label:plan.build_label,
        technical_state:'UNKNOWN',workspace_mutated:false,
        app_foreground_verified:false,external_publication:false});
      return;
    }
    if(!flags['out-dir'])throw Error('An explicit owner-private output directory is required');
    const plan=privatePlan(flags.plan);
    const result=await captureIOSSimulator(app,plan,resolve(flags['out-dir']),{
      confirm_plan_sha256:flags['confirm-plan'],
      confirm_bundle_id:flags['confirm-bundle'],
      confirm_build_label:flags['confirm-build'],
      acknowledge_current_screen:flags['approve-current-screen']===true,
      acknowledge_unverified_foreground:flags['acknowledge-foreground-unknown']===true,
      acknowledge_unverified_pixel_privacy:flags['acknowledge-pixel-privacy']===true
    });
    echo(result);
  }finally{app.close();}
}
main().catch(error=>{
  echo({error:{code:error.code??'InvalidArgument',
    message:error.message,outcome_known:error.outcomeKnown??true}});
  process.exitCode=1;
});
