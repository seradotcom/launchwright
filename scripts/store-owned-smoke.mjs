#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Real owned synthetic store listing packages for independent CI inspection.
import { mkdtempSync,mkdirSync,rmSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve,join } from 'node:path';
import { makeOwnedStoreFixture } from '../tests/store-fixture.mjs';
import { planStorePackage,exportStorePackage } from '../src/store-package.mjs';

const argv=process.argv.slice(2);
if(argv.length!==2||argv[0]!=='--out-dir'){
  process.stderr.write('Usage: node scripts/store-owned-smoke.mjs --out-dir EXISTING_PRIVATE_DIR\n');
  process.exit(2);
}
const root=mkdtempSync(join(tmpdir(),'launchwright-owned-store-'));
const out=resolve(argv[1]);
const profiles=['apple-iphone-dynamic-island-medium','google-play-phone-portrait'];
const results=[];
try{
  for(const platform of profiles){
    const dir=join(root,platform);mkdirSync(dir,{mode:0o700});
    const artifacts=join(out,platform);mkdirSync(artifacts,{mode:0o700});
    const fixture=await makeOwnedStoreFixture(dir,{
      platform,screenshotCount:platform.startsWith('apple')?1:2
    });
    try{
      const plan=planStorePackage(fixture.app,fixture.input);
      const receipt=await exportStorePackage(fixture.app,plan,fixture.input,artifacts,{
        confirm_plan_sha256:plan.plan_sha256,
        confirm_candidate_sha256:plan.candidate_sha256,
        acknowledge_private_export:true
      });
      results.push({
        platform,plan_sha256:plan.plan_sha256,
        screenshot_count:receipt.screenshots,
        zip_sha256:receipt.zip_sha256,
        output_folder:platform,
        receipt,
        synthetic_owned_source:true,technical_state:'UNKNOWN',
        screenshot_pixels_not_independently_captured:true,
        external_store_submission:false,platform_authority:false
      });
    }finally{fixture.close();}
  }
  const report={
    schema_version:'launchwright-owned-store-fixture/1',
    real_png_zip_generation:true,
    real_customer_execution:false,
    real_apple_google_store_accounts:false,
    human_pixel_content_review_pending:true,
    snapshots_technical_only:true,
    results
  };
  writeFileSync(join(out,'owned-smoke.json'),JSON.stringify(report,null,2)+'\n',{
    flag:'wx',mode:0o600
  });
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
}finally{rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:50});}
