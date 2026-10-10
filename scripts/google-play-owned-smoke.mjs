#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// R52 owned synthetic source custody fixture; never contacts Google accounts.
import { mkdtempSync,mkdirSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { makeOwnedStoreFixture } from '../tests/store-fixture.mjs';
import { planStorePackage,exportStorePackage } from '../src/store-package.mjs';
import { prepareGooglePlayStaging } from '../src/google-play-staging.mjs';

const args=process.argv.slice(2);
if(args.length!==2||args[0]!=='--out-dir'){
  process.stderr.write('Usage: node scripts/google-play-owned-smoke.mjs --out-dir PRIVATE_DIRECTORY\n');
  process.exit(2);
}
const root=mkdtempSync(join(tmpdir(),'launchwright-r52-owned-ci-'));
const out=resolve(args[1]);
let fixture;
try{
  const local=join(root,'fixture');mkdirSync(local,{mode:0o700});
  fixture=await makeOwnedStoreFixture(local,{
    platform:'google-play-phone-portrait',screenshotCount:2
  });
  const plan=planStorePackage(fixture.app,fixture.input);
  const generated=await exportStorePackage(
    fixture.app,plan,fixture.input,out,{
      confirm_plan_sha256:plan.plan_sha256,
      confirm_candidate_sha256:plan.candidate_sha256,
      acknowledge_private_export:true
    }
  );
  const archive=join(out,generated.filename);
  const intent=await prepareGooglePlayStaging(
    fixture.app,plan,fixture.input,archive,{
      package_name:'com.owned.fixtureapp',
      edit_id:'owned_edit_fixture_2026_01',
      acknowledge_uncommitted_only:true
    }
  );
  const report={
    schema_version:'launchwright-google-play-owned-fixture/1',
    source_sha256:generated.zip_sha256,
    bundle_filename:generated.filename,
    source_plan_sha256:plan.plan_sha256,
    candidate_sha256:plan.candidate_sha256,
    intent_sha256:intent.intent_sha256,
    phone_screenshots:intent.assets.filter(x=>x.type==='phoneScreenshots').length,
    graphic_types:intent.assets.filter(x=>x.type!=='phoneScreenshots').map(x=>x.type),
    private_operator_source:true,
    pixels_generated_synthetically:true,
    independent_device_capture_accepted:false,
    independent_pixel_privacy_accepted:false,
    google_play_account_contacted:false,
    operator_edit_committed:false,
    google_play_store_published:false,
    platform_authority:false,
    technical_state:'UNKNOWN'
  };
  writeFileSync(join(out,'intent.json'),JSON.stringify(intent,null,2)+'\n',{
    flag:'wx',mode:0o600
  });
  writeFileSync(join(out,'owned-acceptance.json'),JSON.stringify(report,null,2)+'\n',{
    flag:'wx',mode:0o600
  });
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
}finally{
  try{fixture?.close();}finally{
    rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:50});
  }
}
