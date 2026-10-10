#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Owned disposable Android CI acceptance fixture -> canonical Native imported
// evidence. NEVER a real customer, physical phone, Driver Host or Platform job.
import { mkdtempSync,rmSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve,join } from 'node:path';
import { LaunchwrightApplication, execute } from '../src/application.mjs';
import {
  inspectLocalAndroidEmulator,planAndroidEmulatorCapture,captureAndroidEmulator
} from '../src/android-emulator-capture.mjs';

const [action,out]=process.argv.slice(2);
if(action!=='--out-dir'||!out){
  process.stderr.write('Usage: node scripts/android-owned-smoke.mjs --out-dir EXISTING_PRIVATE_DIR\n');
  process.exitCode=2;
}else{
  const workspace=mkdtempSync(join(tmpdir(),'launchwright-android-e2e-'));
  let app=null;
  try{
    const output=resolve(out),serial='emulator-5554';
    const packageName='com.launchwright.ownedfixture';
    const device=inspectLocalAndroidEmulator({serial,package_name:packageName});
    app=new LaunchwrightApplication(workspace,{initialize:true});
    const create=async(kind,data)=>(await execute(app,'entity.create',{kind,data})).entity;
    const build='owned-android-ci-app-source-v1';
    const product=await create('product',{
      name:'Owned Android emulator fixture',description:'Synthetic app compiled in GitHub Actions only'
    });
    const release=await create('release',{
      product_id:product.id,name:'Synthetic mobile snapshot',build,status:'draft'
    });
    const source=await create('source',{
      product_id:product.id,name:'Owner-approved local emulator app',
      type:'mobile-import',locator:'android-emulator:'+packageName,build,
      coverage:'declared',approval:'approved',
      purpose:'Capture one owned synthetic app screen on a GitHub Actions emulator only'
    });
    const target=await create('target',{
      release_id:release.id,name:'Android synthetic portrait snapshot',
      ui_locale:'en-US',editorial_locale:'en-US',
      role:'owner',plan:'ci-only',region:'US',flags:{},
      viewport:{width:device.width,height:device.height,scale_milli:1000}
    });
    const input={
      release_id:release.id,target_id:target.id,source_id:source.id,
      serial,package_name:packageName,rights:'owned',
      acknowledge_emulator_only:true,acknowledge_imported_unknown:true
    };
    const plan=planAndroidEmulatorCapture(app,input);
    writeFileSync(join(output,'private-android-plan.json'),
      JSON.stringify(plan,null,2)+'\n',{mode:0o600,flag:'wx'});
    const confirm={
      confirm_plan_sha256:plan.plan_sha256,
      confirm_package:packageName,
      confirm_build_label:build,
      acknowledge_capture_current_screen:true,
      acknowledge_pixel_privacy_unverified:true
    };
    const first=await captureAndroidEmulator(app,plan,output,confirm);
    const second=await captureAndroidEmulator(app,plan,output,confirm);
    if(!first.captured_now||!second.reconciled_from_saved_receipt||
      second.evidence_id!==first.evidence_id)
      throw Error('Emulator capture did not maintain exact receipt/idempotent custody');
    const receipt=app.get(first.evidence_id,'evidence');
    if(receipt.data.technical!=='UNKNOWN'||
      receipt.data.admission!=='imported-declaration'||
      receipt.data.host_acceptance!=='NOT_ESTABLISHED')
      throw Error('Emulator source incorrectly upgraded technical or Driver Host authority');
    const report={
      schema_version:'launchwright-r48-owned-emulator-e2e/1',
      fixture_app_package:packageName,
      owned_synthetic_android_apk:true,
      emulator_connected:true,
      device_dimensions:[device.width,device.height],
      device_sdk:device.sdk,
      source_declared_build:build,
      source_build_verified_on_device:false,
      installed_apk_content_hash_verified:false,
      original_native_evidence_state:receipt.data.technical,
      native_evidence_id:receipt.id,
      native_evidence_origin_digest:receipt.data.origin_digest,
      screenshot_png_sha256:first.screenshot_sha256,
      screenshot_filename:first.screenshot_filename,
      original_observed_png_sha256:first.original_screenshot_sha256,
      plan_sha256:plan.plan_sha256,
      recovery_did_not_recapture:second.reconciled_from_saved_receipt,
      driver_host_admission:false,
      real_customer_acceptance:false,
      real_mobile_hardware_acceptance:false,
      pixel_privacy_independently_verified:false,
      platform_publish_authority:false,
      app_started_by_adapter:false,
      external_publication:false
    };
    process.stdout.write(JSON.stringify(report,null,2)+'\n');
  }catch(e){
    process.stderr.write('R48 emulator-owned E2E cannot claim success: '+e.message+'\n');
    process.exitCode=1;
  }finally{
    try{app?.close();}finally{
      rmSync(workspace,{recursive:true,force:true,maxRetries:5,retryDelay:50});
    }
  }
}
