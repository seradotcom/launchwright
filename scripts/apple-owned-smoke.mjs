#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Owned synthetic Apple screenshot provenance + exact R44 ZIP and R51 intent.
// This fixture NEVER contacts App Store Connect. The official HTTP mock
// protocol is exercised independently by tests/apple-screenshot-upload.test.mjs.
import { mkdtempSync,rmSync,writeFileSync,lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve,join } from 'node:path';
import { createHash } from 'node:crypto';
import { makeOwnedStoreFixture } from '../tests/store-fixture.mjs';
import { planStorePackage,exportStorePackage } from '../src/store-package.mjs';
import { prepareAppleScreenshotUpload } from '../src/apple-screenshot-upload.mjs';

const argv=process.argv.slice(2);
if(argv.length!==2||argv[0]!=='--out-dir'){
  process.stderr.write('Usage: node scripts/apple-owned-smoke.mjs --out-dir EXISTING_PRIVATE_0700_DIR\n');
  process.exit(2);
}
const out=resolve(argv[1]);
const stat=lstatSync(out);
if(!stat.isDirectory()||stat.isSymbolicLink()||
  (process.platform!=='win32'&&(stat.mode&0o077)!==0))
  throw Error('Owned screenshot CI output must be an existing private 0700 directory');
const root=mkdtempSync(join(tmpdir(),'launchwright-r51-owned-'));
let f;
try{
  f=await makeOwnedStoreFixture(root,{
    platform:'apple-iphone-dynamic-island-medium',screenshotCount:1
  });
  const plan=planStorePackage(f.app,f.input);
  const bundle=await exportStorePackage(f.app,plan,f.input,out,{
    confirm_plan_sha256:plan.plan_sha256,
    confirm_candidate_sha256:plan.candidate_sha256,
    acknowledge_private_export:true
  });
  const zipPath=join(out,bundle.filename);
  const intent=await prepareAppleScreenshotUpload(
    f.app,plan,f.input,zipPath,{
      screenshot_set_id:'synthetic_set_not_an_account',
      localization_id:'synthetic_localization_not_an_account',
      screenshot_display_type:'APP_IPHONE_61',
      acknowledge_asset_only:true
    });
  writeFileSync(join(out,'intent.json'),JSON.stringify(intent,null,2)+'\n',
    {flag:'wx',mode:0o600});
  const report={
    schema_version:'launchwright-apple-r51-owned-fixture/1',
    source_context:'owned-synthetic-Native-SDK',
    source_pixel_sha256:intent.images[0].sha256,
    source_zip_sha256:intent.source_zip_sha256,
    source_plan_sha256:plan.plan_sha256,
    candidate_sha256:plan.candidate_sha256,
    intent_sha256:intent.intent_sha256,
    store_zip_filename:bundle.filename,
    store_zip_bytes:bundle.bytes,
    image_bytes:intent.images[0].bytes,
    screenshot_count:1,
    image_md5:intent.images[0].md5,
    actual_apple_account_contacted:false,
    mock_rest_tests_separately_required:true,
    app_review_submitted:false,app_published:false,
    platform_authority:false,technical_state:'UNKNOWN',
    independent_privacy_certification:false
  };
  writeFileSync(join(out,'owned-acceptance.json'),JSON.stringify(report,null,2)+'\n',
    {flag:'wx',mode:0o600});
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
}finally{
  try{f?.close();}finally{
    rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:50});
  }
}
