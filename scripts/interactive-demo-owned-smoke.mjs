#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// R43 manual CI owner fixture, never user/customer capture or Host execution.
import { mkdtempSync,rmSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve,join } from 'node:path';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { makeOwnedInteractiveFixture } from '../tests/interactive-fixture.mjs';
import { planInteractiveDemo,exportInteractiveDemo } from '../src/interactive-demo.mjs';

const argv=process.argv.slice(2);
if(argv.length!==2||argv[0]!=='--out-dir'){
  process.stderr.write('Usage: node scripts/interactive-demo-owned-smoke.mjs --out-dir /absolute/existing/0700/output\n');
  process.exit(2);
}
const output=resolve(argv[1]),local=mkdtempSync(join(tmpdir(),'lw-r43-owned-smoke-'));
let fixture;
try{
  fixture=await makeOwnedInteractiveFixture(local);
  const plan=planInteractiveDemo(fixture.app,fixture.input);
  const receipt=await exportInteractiveDemo(fixture.app,plan,fixture.input,output,{
    confirm_plan_sha256:plan.plan_sha256,
    confirm_media_plan_digest:plan.media_plan_digest,
    acknowledge_private_export:true
  });
  const buffer=(await import('node:fs')).readFileSync(join(output,receipt.filename));
  const zip=await JSZip.loadAsync(buffer,{checkCRC32:true});
  for(const name of ['index.html','manifest.json','README.txt']){
    writeFileSync(join(output,name),await zip.file(name).async('nodebuffer'),{
      flag:'wx',mode:0o600
    });
  }
  const manifest=JSON.parse(await zip.file('manifest.json').async('string'));
  const report={
    schema_version:'launchwright-interactive-demo-owned-ci/1',
    owner_synthetic_fixture:true,
    canonical_customer_capture:false,
    composition_host_executed:false,
    source_rights_basis:'operator-owned-synthetic',
    screen_count:receipt.steps,
    media_plan_digest:plan.media_plan_digest,
    original_media_output_id:receipt.media_output_id,
    bundle_filename:receipt.filename,
    bundle_sha256:receipt.artifact_sha256,
    manifest_sha256:createHash('sha256').update(
      (await zip.file('manifest.json').async('nodebuffer'))).digest('hex'),
    html_sha256:manifest.html_sha256,
    script_free:true,
    pixel_privacy_independently_verified:false,
    technical_state:'UNKNOWN',
    network_access_performed:false,
    external_publication:false,
    platform_authority:false,
    receipt
  };
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
}finally{
  try{fixture?.close();}finally{rmSync(local,{
    recursive:true,force:true,maxRetries:5,retryDelay:50
  });}
}
