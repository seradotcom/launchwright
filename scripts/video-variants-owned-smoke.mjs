#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Disposable owned synthetic VIDEO acceptance: real H264/AAC, immutable VTT,
// Native Media source/review and a derived aspect-only private ZIP.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ownedVideoFixture } from '../tests/video-variants-fixture.mjs';
import { planVideoVariants,exportVideoVariants } from '../src/video-variants.mjs';

if(process.argv.length!==4||process.argv[2]!=='--out-dir'){
  process.stderr.write('Usage: node scripts/video-variants-owned-smoke.mjs --out-dir EXISTING_PRIVATE_0700_DIR\n');
  process.exit(2);
}
const t={after(){}},dest=resolve(process.argv[3]);
let fixture;
try{
  fixture=await ownedVideoFixture(t);
  const plan=planVideoVariants(fixture.app,fixture.input);
  const receipt=await exportVideoVariants(fixture.app,plan,
    fixture.input,dest,fixture.approve(plan));
  const report={
    schema_version:'launchwright-owned-video-variants-smoke/1',
    synthetic_fixture:true,customer_source_captured:false,
    exact_native_media_plan_id:plan.media_plan_id,
    native_media_source_authority:'imported',
    native_media_output_id:receipt.media_output_id,
    output_zip_sha256:receipt.zip_sha256,
    source_mp4_sha256:receipt.source_mp4_sha256,
    frozen_webvtt_sha256:receipt.captions_sha256,
    format_count:2,
    source_audio_preserved:true,
    source_timeline_recomposed:false,
    portrait_cropping_performed:false,
    captions_embedded_as_sidecar:true,
    alternate_voice_created:false,
    technical_state:'UNKNOWN',
    human_format_editorial_review_pending:true,
    public_release_created:false,platform_authority:false,
    receipt
  };
  writeFileSync(dest+'/owned-smoke.json',JSON.stringify(report,null,2)+'\n',{
    flag:'wx',mode:0o600
  });
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
}finally{
  try{fixture?.app.close();}catch{}
}
