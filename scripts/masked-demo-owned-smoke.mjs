#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Real owned disposable Native Media / R55 pixel mask / R59 offline bundle.
import{mkdtempSync,rmSync,lstatSync,writeFileSync}from'node:fs';
import{tmpdir}from'node:os';
import{join,resolve}from'node:path';
import{createHash}from'node:crypto';
import JSZip from'jszip';
import{makeOwnedMaskedDemoFixture}from'../tests/masked-demo-fixture.mjs';
import{planMaskedInteractiveDemo,exportMaskedInteractiveDemo}
  from'../src/masked-interactive-demo.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const args=process.argv.slice(2);
if(args.length!==2||args[0]!=='--out-dir'){
  process.stderr.write('Usage: node scripts/masked-demo-owned-smoke.mjs --out-dir /private/existing/0700/dir\n');
  process.exit(2);
}
const dest=resolve(args[1]),st=lstatSync(dest);
if(!st.isDirectory()||st.isSymbolicLink()||
 (process.platform!=='win32'&&(st.mode&0o077)!==0))throw Error('Owned CI output directory must be private');
const dir=mkdtempSync(join(tmpdir(),'launchwright-r59-owned-'));
let fixture;
try{
  fixture=await makeOwnedMaskedDemoFixture(dir);
  const plan=planMaskedInteractiveDemo(fixture.app,fixture.request);
  const result=await exportMaskedInteractiveDemo(fixture.app,plan,fixture.request,dest,
    fixture.confirmation(plan));
  const bundleBytes=(await import('node:fs')).readFileSync(join(dest,result.bundle_filename));
  const zip=await JSZip.loadAsync(bundleBytes,{checkCRC32:true});
  const html=await zip.file('index.html').async('nodebuffer');
  const manifest=JSON.parse(await zip.file('manifest.json').async('string'));
  writeFileSync(join(dest,'index.html'),html,{flag:'wx',mode:0o600});
  const report={
    schema_version:'launchwright-r59-owned-masked-offline-e2e/1',
    source_sha:process.env.GITHUB_SHA??null,
    owned_synthetic_only:true,
    canonical_device_source_accepted:false,
    real_customer_acceptance:false,
    independent_pixel_privacy_review:false,
    source_scripts_executed:false,
    external_publication:false,platform_authority:false,
    technical_state:'UNKNOWN',
    mask_proof_count:plan.masks.length,
    r55_plan_sha256s:plan.masks.map(p=>p.r55_plan_sha256),
    native_derived_evidence_ids:plan.masks.map(p=>p.derived_evidence_id),
    bundle_filename:result.bundle_filename,
    bundle_sha256:sha(bundleBytes),
    html_sha256:sha(html),
    native_media_output_technical:'UNKNOWN',
    screenshot_pixels_exact_R55:manifest.opaque_mask_pixels_checked===true,
    output_artifact:result
  };
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
}finally{
  try{fixture?.close();}finally{
    rmSync(dir,{recursive:true,force:true,maxRetries:5,retryDelay:50});
  }
}
