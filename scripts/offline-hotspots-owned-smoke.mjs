#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// R61 disposable REAL Native Media + R55 masks + R59 source ZIP + CSS navigation.
// Contains only synthetic owned data and never a customer account/capture.
import { mkdtempSync, rmSync, lstatSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { makeOwnedMaskedDemoFixture } from '../tests/masked-demo-fixture.mjs';
import {
  planMaskedInteractiveDemo,exportMaskedInteractiveDemo
} from '../src/masked-interactive-demo.mjs';
import { planOfflineHotspots,exportOfflineHotspots } from '../src/offline-hotspots.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const args=process.argv.slice(2);
if(args.length!==2||args[0]!=='--out-dir'){
  process.stderr.write('Usage: node scripts/offline-hotspots-owned-smoke.mjs --out-dir /private/existing/0700/output\n');
  process.exit(2);
}
const out=resolve(args[1]),stat=lstatSync(out);
if(!stat.isDirectory()||stat.isSymbolicLink()||
   (process.platform!=='win32'&&(stat.mode&0o077)!==0))
  throw Error('R61 owned synthetic output directory must have private 0700 permissions');
const root=mkdtempSync(join(tmpdir(),'launchwright-r61-synthetic-'));
let fixture=null;
try{
  fixture=await makeOwnedMaskedDemoFixture(root);
  const r59=planMaskedInteractiveDemo(fixture.app,fixture.request);
  const baseline=await exportMaskedInteractiveDemo(fixture.app,r59,fixture.request,
    fixture.outputDir,fixture.confirmation(r59));
  const shots=r59.masks.map(f=>f.shot_id);
  const links=[
    {from_shot_id:shots[0],to_shot_id:shots[1],
      label:'Open captured second state',x:420,y:135,width:90,height:70},
    {from_shot_id:shots[1],to_shot_id:shots[0],
      label:'Return to captured first state',x:420,y:135,width:90,height:70}
  ];
  const options={
    masked_plan:r59,masked_request:fixture.request,
    source_dir:fixture.outputDir,links,
    acknowledge_mask_scope_only:true,acknowledge_private_only:true
  };
  const plan=await planOfflineHotspots(fixture.app,options);
  const result=await exportOfflineHotspots(fixture.app,plan,options,out,{
    confirm_plan_sha256:plan.plan_sha256,
    confirm_r59_bundle_sha256:plan.r59_bundle_sha256,
    acknowledge_private_export:true,
    acknowledge_privacy_outside_masks_unknown:true
  });
  const zipBytes=readFileSync(join(out,result.bundle_filename));
  const zip=await JSZip.loadAsync(zipBytes,{checkCRC32:true});
  const html=await zip.file('index.html').async('nodebuffer');
  const manifest=JSON.parse(await zip.file('manifest.json').async('string'));
  writeFileSync(join(out,'index.html'),html,{flag:'wx',mode:0o600});
  const report={
    schema_version:'launchwright-r61-owned-hotspot-e2e/1',
    source_sha:process.env.GITHUB_SHA??null,
    real_owned_synthetic_fixture:true,
    r55_mask_pixels_verified:true,
    original_r59_bundle_sha256:baseline.bundle_sha256,
    original_r59_plan_sha256:r59.plan_sha256,
    original_r59_media_output_id:baseline.media_output_id,
    hotspot_bundle_filename:result.bundle_filename,
    hotspot_bundle_sha256:sha(zipBytes),
    html_sha256:sha(html),
    hotspot_count:plan.links.length,
    screenshot_count:plan.frame_count,
    source_r55_pixel_hashes:r59.masks.map(x=>x.masked_pixel_sha256),
    origin_manifest_sha256:manifest.r59_manifest_sha256,
    derived_source_has_no_scripts:true,
    native_media_output_count:fixture.app.list('media_output').length,
    app_actions_executed:false,
    pixel_privacy_outside_masks_verified:false,
    canonical_driver_host_accepted:false,
    customer_source_captured:false,
    technical_state:'UNKNOWN',
    remote_network:false,external_publication:false,
    platform_authority:false,
    receipt:result
  };
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
}finally{
  try{fixture?.close();}finally{
    rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:50});
  }
}
