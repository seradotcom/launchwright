#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Operator-owned R48 emulator-only screenshot capture and Native imported proof.
// Never installs/starts any app, touches a physical device or contacts Platform.
import { resolve } from 'node:path';
import { lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { LaunchwrightApplication } from '../src/application.mjs';
import { planAndroidEmulatorCapture, captureAndroidEmulator } from '../src/android-emulator-capture.mjs';

const [verb='help',...args]=process.argv.slice(2);
const allowed=new Set([
  'state','release','target','source','serial','package','rights',
  'out','plan','out-dir','confirm-plan','confirm-package','confirm-build'
]);
const switches=new Set([
  'emulator-only','imported-unknown','approve-screen','acknowledge-pixel-privacy'
]);
function parse(){
  const result={};
  for(let i=0;i<args.length;i++){
    const flag=args[i];
    if(!flag.startsWith('--')||Object.hasOwn(result,flag))
      throw Error('Android emulator capture rejects duplicate or positional arguments');
    const key=flag.slice(2);
    if(switches.has(key)){result[key]=true;continue;}
    if(!allowed.has(key)||!args[i+1]||args[i+1].startsWith('--'))
      throw Error('Android emulator capture has unknown/missing argument');
    result[key]=args[++i];
  }
  const expected=new Set(verb==='plan'
    ? ['state','release','target','source','serial','package','rights','out',
       'emulator-only','imported-unknown']
    : ['state','plan','out-dir','confirm-plan','confirm-package','confirm-build',
       'approve-screen','acknowledge-pixel-privacy']);
  if(Object.keys(result).some(k=>!expected.has(k)))
    throw Error('Android emulator command has extra options');
  return result;
}
function privateJson(file){
  if(!file)throw Error('A private saved Android plan must be supplied');
  const path=resolve(file),stat=lstatSync(path);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>16*1024||
    (process.platform!=='win32'&&(stat.mode&0o077)!==0))
    throw Error('Android plan must be a private 0600 regular file, at most 16 KiB');
  return JSON.parse(readFileSync(path,'utf8'));
}
const print=data=>process.stdout.write(JSON.stringify(data,null,2)+'\n');
async function main(){
  if(verb==='help'){
    process.stdout.write(
      'Launchwright R48: screenshot a local Android EMULATOR ONLY, preserving technical UNKNOWN.\n'+
      ' plan --state DIR --release ID --target ID --source ID --serial emulator-5554 --package com.example.app --rights owned|licensed --out PRIVATE_JSON --emulator-only --imported-unknown\n'+
      ' capture --state DIR --plan PRIVATE_JSON --out-dir PRIVATE_0700_DIR --confirm-plan SHA256 --confirm-package PACKAGE --confirm-build RELEASE_BUILD --approve-screen --acknowledge-pixel-privacy\n'+
      'The operator must independently foreground the selected app before capture. No adb install, app launch, physical-device or GitHub send occurs.\n'
    );return;
  }
  if(!['plan','capture'].includes(verb))throw Error('Unsupported Android emulator action');
  const input=parse();
  if(!input.state)throw Error('A local Launchwright state must be selected');
  const app=new LaunchwrightApplication(resolve(input.state));
  try{
    if(verb==='plan'){
      if(!input.out)throw Error('A private --out file is required');
      const plan=planAndroidEmulatorCapture(app,{
        release_id:input.release,source_id:input.source,target_id:input.target,
        serial:input.serial,package_name:input.package,rights:input.rights,
        acknowledge_emulator_only:input['emulator-only']===true,
        acknowledge_imported_unknown:input['imported-unknown']===true
      });
      writeFileSync(resolve(input.out),JSON.stringify(plan,null,2)+'\n',
        {flag:'wx',mode:0o600});
      print({plan_sha256:plan.plan_sha256,plan_saved:resolve(input.out),
        package_name:plan.emulator.package_name,display:plan.emulator.width+'x'+plan.emulator.height,
        technical_state:'UNKNOWN',workspace_mutated:false,apk_content_hash_verified:false});
      return;
    }
    if(!input['out-dir'])throw Error('An existing private --out-dir is required');
    const plan=privateJson(input.plan);
    const result=await captureAndroidEmulator(app,plan,resolve(input['out-dir']),{
      confirm_plan_sha256:input['confirm-plan'],
      confirm_package:input['confirm-package'],
      confirm_build_label:input['confirm-build'],
      acknowledge_capture_current_screen:input['approve-screen']===true,
      acknowledge_pixel_privacy_unverified:input['acknowledge-pixel-privacy']===true
    });
    print(result);
  }finally{app.close();}
}
main().catch(err=>{
  print({error:{code:err.code??'InvalidArgument',message:err.message,
    outcome_known:err.outcomeKnown??true}});
  process.exitCode=1;
});
