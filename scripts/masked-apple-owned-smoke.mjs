#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// R58 synthetic masked Apple PNGs, Native receipt, R44 ZIP, R51 local PLAN.
// NO raw source PNG, JWT, customer data or Apple developer account in artifact.
import { createHash } from 'node:crypto';
import { existsSync,lstatSync,readFileSync,writeFileSync } from 'node:fs';
import { resolve,join } from 'node:path';
import {makeOwnedMaskedAppleFixture} from '../tests/masked-apple-fixture.mjs';
import {planMaskedApple,exportMaskedApple,prepareMaskedAppleUpload}
  from '../src/masked-apple-handoff.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const args=process.argv.slice(2);
if(args.length!==2||args[0]!=='--out-dir'){
  process.stderr.write('Usage: node scripts/masked-apple-owned-smoke.mjs --out-dir EXISTING_PRIVATE_0700_DIR\n');
  process.exit(2);
}
const out=resolve(args[1]);
const stat=lstatSync(out);
if(!stat.isDirectory()||stat.isSymbolicLink()||
  (process.platform!=='win32'&&(stat.mode&0o077)!==0))
  throw Error('Synthetic screenshot acceptance output must be existing owner-only directory');
let f;
try{
  f=await makeOwnedMaskedAppleFixture();
  const plan=planMaskedApple(f.app,f.bundle);
  const local=await exportMaskedApple(f.app,plan,f.bundle,f.outDir,f.confirm(plan));
  const wrapped=await prepareMaskedAppleUpload(f.app,plan,f.bundle,f.outDir,local,{
    screenshot_set_id:'synthetic_set_not_an_account',
    localization_id:'synthetic_localization_not_an_account',
    screenshot_display_type:'APP_IPHONE_61',acknowledge_asset_only:true
  });
  const saved=[];
  const copy=(from,to)=>{
    if(existsSync(join(out,to)))throw Error('No synthetic output may clobber an earlier result');
    const bytes=readFileSync(from);
    writeFileSync(join(out,to),bytes,{flag:'wx',mode:0o600});
    saved.push({name:to,bytes:bytes.length,sha256:hash(bytes)});
  };
  copy(join(f.outDir,local.store_zip_filename),local.store_zip_filename);
  copy(join(f.outDir,local.receipt_filename),local.receipt_filename);
  const maskPath=f.storeInput.screenshots[0].png.path;
  copy(maskPath,'redacted-source.png');
  const source={
    schema_version:'launchwright-r58-owned-masked-apple/1',
    synthetic_fixture:true,
    actual_apple_account_contacted:false,
    original_source_png_in_artifact:false,
    screenshot_count:plan.screenshot_count,
    screenshot_pixels:[1179,2556],
    mask_plan_sha256:plan.masked_sources[0].pixel_mask_plan_sha256,
    masked_source_png_sha256:plan.masked_sources[0].redacted_png_sha256,
    derived_native_evidence_id:plan.masked_sources[0].derived_evidence_id,
    masked_pixels:plan.masked_sources[0].masked_pixels,
    unmasked_pixels_verified_unchanged:true,
    pii_outside_masks_verified:false,
    source_device_attested:false,
    R44_store_plan_sha256:plan.store_plan_sha256,
    R44_store_zip_sha256:local.store_zip_sha256,
    R51_apple_intent_sha256:wrapped.apple_intent.intent_sha256,
    R51_apple_image_sha256:wrapped.apple_intent.images[0].sha256,
    R51_upload_performed:false,
    store_publication_performed:false,platform_authority:false,
    technical_state:'UNKNOWN',
    exported_files:saved
  };
  writeFileSync(join(out,'masked-apple-acceptance.json'),
    JSON.stringify(source,null,2)+'\n',{flag:'wx',mode:0o600});
  writeFileSync(join(out,'masked-apple-upload-intent.json'),
    JSON.stringify(wrapped,null,2)+'\n',{flag:'wx',mode:0o600});
  process.stdout.write(JSON.stringify(source,null,2)+'\n');
}finally{f?.close();}
