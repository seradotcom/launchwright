#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# Called only inside a disposable booted Android emulator job.
set -euo pipefail
bash scripts/android-owned-apk-build.sh
mkdir -p evidence/android-owned
chmod 0700 evidence/android-owned
node scripts/android-owned-smoke.mjs --out-dir "$GITHUB_WORKSPACE/evidence/android-owned" |
  tee evidence/android-owned/result.json
node --input-type=module <<'NODE'
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';
const dir='evidence/android-owned';
const report=JSON.parse(readFileSync(join(dir,'result.json'),'utf8'));
if(report.schema_version!=='launchwright-r48-owned-emulator-e2e/1'||
  !report.owned_synthetic_android_apk||
  !report.recovery_did_not_recapture||
  report.original_native_evidence_state!=='UNKNOWN'||
  report.real_customer_acceptance!==false||
  report.real_mobile_hardware_acceptance!==false||
  report.platform_publish_authority!==false||
  report.driver_host_admission!==false||
  report.pixel_privacy_independently_verified!==false)
  throw Error('Android emulator receipt violates imported-UNKNOWN acceptance boundaries');
const bytes=readFileSync(join(dir,report.screenshot_filename));
const hash=createHash('sha256').update(bytes).digest('hex');
if(hash!==report.screenshot_png_sha256)
  throw Error('Android captured PNG bytes differ from Native receipt SHA-256');
const pixels=PNG.sync.read(bytes,{checkCRC:true});
if(pixels.width!==report.device_dimensions[0]||
  pixels.height!==report.device_dimensions[1])
  throw Error('Android PNG dimensions differ from exact observed emulator display');
const filled=pixels.data.reduce((n,v,i)=>n+(i%4===3&&v!==0?1:0),0);
if(filled<=pixels.width*pixels.height*0.95)
  throw Error('Android synthetic screenshot is unexpectedly transparent');
console.log('ANDROID_OWNED_EMULATOR_REAL_PIXELS_ACCEPTED',
  report.screenshot_png_sha256,pixels.width,pixels.height);
NODE
