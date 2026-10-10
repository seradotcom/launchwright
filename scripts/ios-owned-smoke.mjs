#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Owned, disposable Xcode CoreSimulator fixture -> canonical Native imported
// evidence only. This is not real customer capture or Driver Host admission.
import { mkdtempSync,rmSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve,join } from 'node:path';
import { LaunchwrightApplication,execute } from '../src/application.mjs';
import {
  inspectIOSSimulator,planIOSSimulator,captureIOSSimulator
} from '../src/ios-simulator-capture.mjs';

const [a,out,b,udidOption,c,bundleOption,e,widthRaw,f,heightRaw]=process.argv.slice(2);
if(a!=='--out-dir'||b!=='--udid'||c!=='--bundle'||e!=='--width'||f!=='--height'||
   !out||!udidOption||!bundleOption||!widthRaw||!heightRaw){
  process.stderr.write('Owned iOS fixture usage: --out-dir PRIVATE_DIR --udid BOOTED_UUID --bundle BUNDLE_ID --width INT --height INT\n');
  process.exitCode=2;
}else{
  const workspace=mkdtempSync(join(tmpdir(),'launchwright-ios-owned-'));
  let app=null;
  try{
    const width=Number(widthRaw),height=Number(heightRaw);
    if(!Number.isInteger(width)||!Number.isInteger(height)||
       width<240||width>1920||height<240||height>3000||
       width*height>5000000)throw Error('Simulator screenshot dimensions are outside owned fixture budget');
    const current=inspectIOSSimulator({udid:udidOption,bundle_id:bundleOption});
    app=new LaunchwrightApplication(workspace,{initialize:true});
    const create=async(kind,data)=>(await execute(app,'entity.create',{kind,data})).entity;
    const build='owned-ios-ci-application-v1';
    const product=await create('product',{
      name:'Owned CoreSimulator iPhone fixture',
      description:'Synthetic no-customer UIKit test app compiled and installed by CI only'
    });
    const release=await create('release',{
      product_id:product.id,name:'Synthetic iOS screenshot review',
      build,status:'draft'
    });
    const source=await create('source',{
      product_id:product.id,name:'Operator-approved CoreSimulator fixture',
      type:'mobile-import',locator:'ios-simulator:'+bundleOption,
      build,coverage:'declared',approval:'approved',
      purpose:'Record one operator-owned synthetic UIKit fixture screenshot from disposable CI CoreSimulator'
    });
    const target=await create('target',{
      release_id:release.id,name:'iPhone simulator synthetic display',
      ui_locale:'en-US',editorial_locale:'en-US',role:'owner',
      plan:'ci-synthetic',region:'US',flags:{},
      viewport:{width,height,scale_milli:1000}
    });
    const request={
      release_id:release.id,source_id:source.id,target_id:target.id,
      udid:udidOption,bundle_id:bundleOption,rights:'owned',
      acknowledge_simulator_only:true,acknowledge_unknown:true
    };
    const plan=planIOSSimulator(app,request);
    const outDir=resolve(out);
    writeFileSync(join(outDir,'private-ios-plan.json'),JSON.stringify(plan,null,2)+'\n',
      {flag:'wx',mode:0o600});
    const confirmation={
      confirm_plan_sha256:plan.plan_sha256,
      confirm_bundle_id:bundleOption,confirm_build_label:build,
      acknowledge_current_screen:true,
      acknowledge_unverified_foreground:true,
      acknowledge_unverified_pixel_privacy:true
    };
    const first=await captureIOSSimulator(app,plan,outDir,confirmation);
    const repeated=await captureIOSSimulator(app,plan,outDir,confirmation);
    if(!first.screenshot_captured_now||!repeated.recovered_without_recapture||
       first.evidence_id!==repeated.evidence_id)
      throw Error('CoreSimulator source capture did not maintain exact receipts or idempotency');
    const evidence=app.get(first.evidence_id,'evidence');
    if(evidence.data.technical!=='UNKNOWN'||
       evidence.data.admission!=='imported-declaration'||
       evidence.data.host_acceptance!=='NOT_ESTABLISHED')
      throw Error('iOS screenshot cannot upgrade technical or Driver Host evidence authority');
    const report={
      schema_version:'launchwright-r49-owned-ios-simulator-e2e/1',
      owned_synthetic_ios_app:true,
      screenshot_ran_on_real_apple_coresimulator:true,
      local_iphone_simulator_only:true,
      simulator_udid:current.udid,
      simulator_runtime:current.runtime,
      simulator_device_type:current.device_type,
      selected_bundle_id:bundleOption,
      source_build_label:build,
      source_build_verified_on_device:false,
      app_foreground_independently_verified:false,
      app_binary_attested:false,
      screenshot_width:width,screenshot_height:height,
      screenshot_normalized_sha256:first.normalized_png_sha256,
      original_simulator_png_sha256:first.original_png_sha256,
      screenshot_filename:first.screenshot_filename,
      plan_sha256:plan.plan_sha256,
      evidence_id:evidence.id,
      evidence_origin_digest:evidence.data.origin_digest,
      native_evidence_technical:evidence.data.technical,
      native_evidence_admission:evidence.data.admission,
      recover_exact_original_without_simulator_recapture:true,
      adapter_installed_or_launched_any_app:false,
      physical_device_touched:false,
      independent_privacy_or_rights_verified:false,
      customer_device_or_app_accepted:false,
      driver_host_accepted:false,platform_publish_authority:false,
      external_publication:false
    };
    process.stdout.write(JSON.stringify(report,null,2)+'\n');
  }catch(error){
    process.stderr.write('R49 owned CoreSimulator acceptance cannot claim success: '+error.message+'\n');
    process.exitCode=1;
  }finally{
    try{app?.close();}finally{
      rmSync(workspace,{recursive:true,force:true,maxRetries:5,retryDelay:50});
    }
  }
}
