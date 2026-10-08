// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const workflow=readFileSync(new URL('../.github/workflows/heavy.yml',import.meta.url),'utf8');
const harness=readFileSync(new URL('../scripts/verify-effects-runtime.py',import.meta.url),'utf8');
const driver=readFileSync(new URL('../crates/launchwright-effects-driver/src/main.rs',import.meta.url),'utf8');
const nativeDriver=readFileSync(new URL('../crates/launchwright-native/src/main.rs',import.meta.url),'utf8');
const runtime=readFileSync(new URL('../src/effects-runtime.mjs',import.meta.url),'utf8');
const semwrightSha='8fa191250ae68274182570c65f067f7a60f85625';

test('R29 effects lane runs the canonical reader inside exact-SHA Driver Host',()=>{
  assert.match(workflow,/inputs.lane == 'all' || inputs.lane == 'effects'/u);
  assert.match(workflow,new RegExp('SEMWRIGHT_SHA: '+semwrightSha,'u'));
  assert.match(workflow,/cargo test -p launchwright-effects-driver/u);
  assert.match(workflow,/cargo build -p launchwright-native -p launchwright-effects-driver/u);
  assert.match(workflow,/verify-effects-runtime.py/u);
  assert.match(workflow,/LAUNCHWRIGHT_NATIVE_EFFECTS_RUNTIME_BUNDLE_SHA256/u);
  assert.match(workflow,/effects_evaluation_driver_host_isolation_accepted == true/u);
  assert.match(workflow,/native_browser_godot_mutation_effect_authority == false/u);
});

test('R29 provider has one fixed verification input and no caller-selected path or executable',()=>{
  assert.match(driver,/driver.launchwright-effects.verify/u);
  assert.match(driver,/driver.launchwright-effects.probe/u);
  assert.match(driver,/const PROTECTED_MOUNT: &str = "effects-protected"/u);
  assert.match(driver,/const ARTIFACT_MOUNT: &str = "effects-artifacts"/u);
  assert.match(driver,/const SPEC_FILE: &str = "spec.json"/u);
  assert.match(driver,/effects_readback::verify/u);
  assert.match(driver,/properties\.len\(\), 1/u);
  assert.match(driver,/properties\.contains_key\("spec_sha256"\)/u);
  assert.match(driver,/Effects evaluation requires an authenticated Driver Host context/u);
  assert.doesNotMatch(driver,/std::process::Command/u);
});

test('R29 isolates effects.record behind a receipt-aware Native profile',()=>{
  assert.match(nativeDriver,/Profile::EffectsRuntime/u);
  assert.match(nativeDriver,/"node-effects-runtime"/u);
  assert.match(nativeDriver,/Some\("effects-receipts"\)/u);
  assert.match(runtime,/EFFECTS_RUNTIME_PROVIDER='driver:launchwright-effects'/u);
  assert.match(runtime,/EFFECTS_READER_SOURCE_SHA256='215295d2a2510c24864d4226e6b78c1abe3de04601c85c59a99543d8ef1336ff'/u);
  assert.match(runtime,/evaluator_executable_sha256===receipt\.provider_executable_sha256/u);
  assert.match(runtime,/result\.runtime_digest===receipt\.evaluator_executable_sha256/u);
  assert.match(runtime,/platform_execution_authority===false/u);
  assert.match(runtime,/external_customer_acceptance===false/u);
});

test('R29 acceptance proves substitution denial without widening Effects authority',()=>{
  assert.match(harness,/"spec_sha256": "0" \* 64/u);
  assert.match(harness,/r29-result-substitution.json/u);
  assert.match(harness,/runtime_digest_substitution_rejected/u);
  assert.match(harness,/allow_effects=False/u);
  assert.match(harness,/"execution_authority": False/u);
  assert.match(harness,/"scenario_effects_authority": False/u);
  assert.match(harness,/"native_browser_godot_mutation_effect_authority": False/u);
  assert.match(harness,/"platform_execution_authority": False/u);
  assert.match(harness,/"publication_authority": False/u);
});
