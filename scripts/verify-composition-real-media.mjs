#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCompositionEvidence } from '../src/composition-evidence.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const sourceLock=JSON.parse(readFileSync(join(root,'SOURCE_LOCK.json'),'utf8'));
const expected=sourceLock.native_sdk.sha;
const browserPath=resolve(process.env.DELTADESK_DRIVER_RECEIPT??join(root,'evidence/deltadesk/semwright-deltadesk-driver.json'));
const mediaPath=resolve(process.env.LAUNCHWRIGHT_REAL_MEDIA_RECEIPT??join(root,'evidence/composition/launchwright-real-media-driver.json'));
const avPath=resolve(process.env.SEMWRIGHT_COMBINED_AV_RECEIPT??join(root,'.ci-semwright/verification/composition-av/combined-native.json'));
const outPath=resolve(process.env.LAUNCHWRIGHT_COMPOSITION_CHAIN??join(root,'evidence/composition/launchwright-composition-chain.json'));

const read=path=>JSON.parse(readFileSync(path,'utf8'));
const sha=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const browser=read(browserPath),media=read(mediaPath),av=read(avPath);
const browserDir=dirname(browserPath),mediaDir=dirname(mediaPath);
for(const row of browser.captures){
  const path=join(browserDir,row.screenshot.file);
  assert.equal(sha(path),row.screenshot.sha256,'Captured screenshot bytes changed');
}
const videoPath=join(mediaDir,media.artifact.file);
assert.equal(sha(videoPath),media.artifact.sha256,'Retained MP4 bytes differ from Driver Host receipt');

const report=validateCompositionEvidence({
  expected_semwright_sha:expected,
  browser_receipt:browser,
  media_receipt:media,
  av_receipt:av
});
mkdirSync(dirname(outPath),{recursive:true});
writeFileSync(outPath,JSON.stringify({...report,inputs:{
  browser_receipt_sha256:sha(browserPath),
  media_receipt_sha256:sha(mediaPath),
  canonical_av_receipt_sha256:sha(avPath)
}},null,2)+'\n');
process.stdout.write(JSON.stringify(report)+'\n');
