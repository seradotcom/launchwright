#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// R62 owned synthetic real MP4/AAC, exact Native Media/R46 WebVTT, FFmpeg
// caption burn-in and zipped receipt. This is not customer media/capture.
import { resolve, join } from 'node:path';
import { lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { ownedVideoFixture } from '../tests/video-variants-fixture.mjs';
import { planVideoVariants, exportVideoVariants } from '../src/video-variants.mjs';
import { planVideoCaptionBurnin, planVideoCaptionBurninLatin, exportVideoCaptionBurnin } from '../src/video-caption-burnin.mjs';

const args=process.argv.slice(2);
const latin=args.length===3&&args[2]==='--latin-nfc';
if((args.length!==2&&!latin)||args[0]!=='--out-dir'){
  process.stderr.write('Usage: node scripts/video-caption-burnin-owned-smoke.mjs --out-dir PRIVATE_EXISTING_0700_DIR [--latin-nfc]\n');
  process.exit(2);
}
const dir=resolve(args[1]),stat=lstatSync(dir);
if(!stat.isDirectory()||stat.isSymbolicLink()||
  (process.platform!=='win32'&&(stat.mode&0o077)!==0))
  throw Error('Synthetic video output requires an existing private 0700 directory');

let fixture=null;const cleanups=[];
const t={after(fn){cleanups.push(fn);}};
try{
  fixture=await ownedVideoFixture(t,latin?{
    locale:'es-MX',
    captionTexts:['¡Ya está disponible!','Revisión de edición: función útil.']
  }:{});
  const r46Plan=planVideoVariants(fixture.app,fixture.input);
  const r46Receipt=await exportVideoVariants(
    fixture.app,r46Plan,fixture.input,fixture.outDir,fixture.approve(r46Plan));
  const selection={
    r46_plan:r46Plan,r46_input:fixture.input,r46_dir:fixture.outDir,
    acknowledge_caption_review:true,
    acknowledge_video_privacy_unknown:true,acknowledge_private_only:true,
    acknowledge_latin_glyph_review:latin
  };
  const plan=await (latin?planVideoCaptionBurninLatin:
    planVideoCaptionBurnin)(fixture.app,selection);
  const receipt=await exportVideoCaptionBurnin(fixture.app,plan,selection,dir,{
    confirm_plan_sha256:plan.plan_sha256,
    confirm_r46_zip_sha256:plan.r46_zip_sha256,
    acknowledge_private_export:true
  });
  // This CI fixture is explicitly synthetic: retain its original R46 ZIP
  // for independent audio/pixel comparisons without original customer data.
  const originalZipName='owned-r46-original.zip';
  const originalBytes=readFileSync(join(fixture.outDir,r46Receipt.zip_filename));
  writeFileSync(join(dir,originalZipName),originalBytes,{
    mode:0o600,flag:'wx'
  });
  const report={
    schema_version:latin?'launchwright-r63-owned-caption-latin-smoke/1':
      'launchwright-r62-owned-caption-burnin-smoke/1',
    source_sha:process.env.GITHUB_SHA??null,
    synthetic_fixture:true,
    real_customer_source:false,
    original_native_media_source_authority:'imported',
    original_media_plan_digest:plan.media_plan_digest,
    original_r46_plan_sha256:r46Plan.plan_sha256,
    original_r46_zip_sha256:r46Receipt.zip_sha256,
    original_r46_zip_filename:originalZipName,
    original_media_private_customer_content:false,
    original_webvtt_sha256:r46Plan.captions_sha256,
    output_zip_filename:receipt.zip_filename,
    output_zip_sha256:receipt.bundle_sha256,
    exact_cue_count:plan.cue_count,
    ...(latin?{charset_policy:plan.charset_policy,
      caption_locale:plan.caption_locale,
      system_font_sha256:plan.system_font_sha256,
      all_caption_glyphs_present_in_font:plan.all_caption_glyphs_present_in_font}:{}),
    source_audio_unchanged:true,
    two_real_captioned_mp4s:true,
    technical_state:'UNKNOWN',caption_layout_human_review_pending:true,
    independent_privacy_review:false,
    source_scripts_executed:false,remote_network:false,
    public_release_created:false,platform_authority:false,
    receipt
  };
  writeFileSync(dir+'/acceptance.json',JSON.stringify(report,null,2)+'\n',{
    mode:0o600,flag:'wx'
  });
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
}finally{
  try{fixture?.app.close();}catch{}
  for(const fn of cleanups.reverse())try{fn();}catch{}
}
