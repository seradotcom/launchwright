#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSingleRecipeCompositionEvidence } from '../src/composition-single-recipe.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const sourceLock=JSON.parse(readFileSync(join(root,'SOURCE_LOCK.json'),'utf8'));
const expectedSemwright=sourceLock.native_sdk.sha;
const expectedLaunchwright=process.env.LAUNCHWRIGHT_SOURCE_SHA;
assert.match(expectedLaunchwright??'',/^[0-9a-f]{40}$/,'LAUNCHWRIGHT_SOURCE_SHA must be an immutable full SHA');

const brokerPath=resolve(process.env.DELTADESK_BROKER_RECEIPT??join(root,'evidence/composition/semwright-deltadesk-broker.json'));
const recipePath=resolve(process.env.LAUNCHWRIGHT_SINGLE_RECIPE_RECEIPT??join(root,'verification/composition-av/launchwright-deltadesk-single-recipe.json'));
const masterPath=resolve(process.env.LAUNCHWRIGHT_SINGLE_RECIPE_MASTER??join(dirname(recipePath),'launchwright-deltadesk-single-recipe.mp4'));
const outPath=resolve(process.env.LAUNCHWRIGHT_SINGLE_RECIPE_CHAIN??join(root,'evidence/composition/launchwright-composition-single-recipe-chain.json'));

const read=path=>JSON.parse(readFileSync(path,'utf8'));
const sha=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const broker=read(brokerPath),recipe=read(recipePath);
for(const row of broker.captures){
  const path=join(dirname(brokerPath),row.screenshot.file);
  assert.equal(sha(path),row.screenshot.sha256,'Retained Broker screenshot bytes changed');
}
assert.equal(sha(masterPath),recipe.artifact.sha256,'Retained single-recipe MP4 bytes differ from receipt');

const report=validateSingleRecipeCompositionEvidence({
  expected_semwright_sha:expectedSemwright,
  expected_launchwright_sha:expectedLaunchwright,
  broker_receipt:broker,
  recipe_receipt:recipe
});
mkdirSync(dirname(outPath),{recursive:true});
writeFileSync(outPath,JSON.stringify({...report,inputs:{
  broker_receipt_sha256:sha(brokerPath),
  recipe_receipt_sha256:sha(recipePath),
  retained_master_sha256:sha(masterPath)
}},null,2)+'\n');
process.stdout.write(JSON.stringify(report)+'\n');
