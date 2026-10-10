#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// R56 exact-owned fixture only: R55 real masks -> Native -> R44 ZIP ->
// R52 prepare-only. Never uses a Google developer account or uploads images.
import { createHash } from 'node:crypto';
import { lstatSync,readFileSync,writeFileSync } from 'node:fs';
import { resolve,join } from 'node:path';
import { makeOwnedMaskedStoreFixture } from '../tests/masked-store-fixture.mjs';
import { planStorePackage } from '../src/store-package.mjs';
import { prepareGooglePlayStaging } from '../src/google-play-staging.mjs';
import { planMaskedStore,exportMaskedStore } from '../src/masked-store-handoff.mjs';

const SHA=v=>createHash('sha256').update(v).digest('hex');
const print=v=>process.stdout.write(JSON.stringify(v,null,2)+'\n');
async function main(){
  const args=process.argv.slice(2);
  if(args.length!==2||args[0]!=='--out-dir')
    throw Error('Expected only --out-dir EXISTING_PRIVATE_0700_DIR');
  const dir=resolve(args[1]),stat=lstatSync(dir);
  if(!stat.isDirectory()||stat.isSymbolicLink()||
    (process.platform!=='win32'&&(stat.mode&0o077)!==0))
    throw Error('Owned synthetic output must be an existing private 0700 directory');
  const f=await makeOwnedMaskedStoreFixture();
  try{
    const plan=planMaskedStore(f.app,f.bundle);
    const result=await exportMaskedStore(f.app,plan,f.bundle,f.storeDir,f.confirm(plan));
    const storePlan=planStorePackage(f.app,f.storeInput);
    const sourceZip=join(f.storeDir,result.store_zip_filename);
    const staged=await prepareGooglePlayStaging(f.app,storePlan,f.storeInput,sourceZip,{
      package_name:'com.owned.maskedfixture',
      edit_id:'owned_r56_uncommitted',
      acknowledge_uncommitted_only:true
    });
    if(staged.assets.length!==4||staged.platform_authority!==false||
      staged.published!==false||staged.source_device_attestation!==false)
      throw Error('R52 local preparation unexpectedly promoted authority');
    const copied=[];
    function safeCopy(original,filename){
      const bytes=readFileSync(original);
      writeFileSync(join(dir,filename),bytes,{flag:'wx',mode:0o600});
      copied.push({filename,bytes:bytes.length,sha256:SHA(bytes)});
    }
    safeCopy(sourceZip,result.store_zip_filename);
    safeCopy(join(f.storeDir,result.proof_filename),result.proof_filename);
    safeCopy(join(f.storeDir,'launchwright-store-'+storePlan.plan_sha256.slice(0,12)+'.receipt.json'),
      'launchwright-store-'+storePlan.plan_sha256.slice(0,12)+'.receipt.json');
    for(const [i,item] of f.storeInput.screenshots.entries())
      safeCopy(item.png.path,'owned-masked-screen-'+String(i+1)+'.png');
    const report={
      schema_version:'launchwright-r56-owned-masked-store/1',
      source:'OWNED_SYNTHETIC_ONLY',
      screenshot_dimensions:[1080,1920],
      screenshot_count:plan.screenshot_count,
      masks_sha256:plan.masked_sources.map(x=>x.pixel_mask_plan_sha256),
      derived_native_evidence_ids:plan.masked_sources.map(x=>x.derived_evidence_id),
      masked_source_png_sha256:plan.masked_sources.map(x=>x.redacted_png_sha256),
      store_zip_sha256:result.store_zip_sha256,
      store_plan_sha256:result.store_plan_sha256,
      google_staging_prepare_only:true,
      google_staging_asset_count:staged.assets.length,
      pixel_masks_operator_declared:true,
      unmasked_pixels_proven_unchanged:true,
      pii_outside_masks_accepted:false,
      canonical_device_capture_accepted:false,
      independent_marketing_graphic_privacy:false,
      real_customer_source_tested:false,
      google_play_account_connected:false,
      remote_play_upload_performed:false,
      play_edit_committed:false,
      published:false,platform_authority:false,
      technical_state:'UNKNOWN',
      originals_retained_in_artifact:false,
      exported_files:copied
    };
    print(report);
  }finally{f.close();}
}
main().catch(error=>{
  print({error:{code:error.code??'InvalidArgument',
    message:error.message,outcome_known:true}});
  process.exitCode=1;
});
