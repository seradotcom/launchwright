// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow=readFileSync(new URL('../.github/workflows/heavy.yml',import.meta.url),'utf8');
const harness=readFileSync(new URL('../scripts/verify-native-host.py',import.meta.url),'utf8');
const lock=JSON.parse(readFileSync(new URL('../SOURCE_LOCK.json',import.meta.url),'utf8'));
const semwrightSha='4d291de26724810017ce7b6d185326514cb79fa6';

test('R19 Host lane stays pinned to the canonical Semwright source lock',()=>{
  assert.equal(lock.native_sdk.sha,semwrightSha);
  assert.match(workflow,/options: \[all, native, host, browser,/u);
  assert.match(workflow,new RegExp('SEMWRIGHT_SHA: '+semwrightSha,'u'));
  assert.match(workflow,/SEMWRIGHT_TEST_DRIVER_SANDBOX: '1'/u);
  assert.match(workflow,/SEMWRIGHT_TEST_SANDBOX_HELPER:/u);
  assert.match(workflow,/verify-native-host\.py/u);
  assert.match(workflow,/LAUNCHWRIGHT_NATIVE_EFFECTS_BUNDLE_SHA256/u);
});

test('R19 Host harness requires real Broker policy and a Host-mediated Node runtime',()=>{
  assert.match(harness,/provenance\.get\("provider"\) != "driver:launchwright"/u);
  assert.match(harness,/"protocol": 5/u);
  assert.match(harness,/"host_tools": True/u);
  assert.match(harness,/"launchwright-runtime", "read_only": True/u);
  assert.match(harness,/"launchwright-data", "read_only": False/u);
  assert.match(harness,/"launchwright-node"/u);
  assert.match(harness,/allow_driver=False/u);
  assert.match(harness,/fixture\.session\.unlink\(missing_ok=True\)/u);
});

test('R19 evidence cannot promote Host acceptance into external Platform authority',()=>{
  assert.match(harness,/"driver_host_isolation_accepted": True/u);
  assert.match(harness,/"broker_policy_path_observed": True/u);
  assert.match(harness,/"host_mediated_node_runtime": True/u);
  assert.match(harness,/"platform_external_acceptance": False/u);
  assert.match(harness,/"chatgpt_host_acceptance": False/u);
  assert.match(harness,/"public_channel_acceptance": False/u);
});

test('R20 Host harness exercises extension lifecycle without promoting external fixture execution',()=>{
  assert.match(harness,/class HostClient/u);
  assert.match(harness,/extension_lifecycle_flow/u);
  assert.match(harness,/extension-register/u);
  assert.match(harness,/extension-prepare_use/u);
  assert.match(harness,/extension-result_record/u);
  assert.match(harness,/source-cli_ingest/u);
  assert.match(harness,/compatibility-lock/u);
  assert.match(harness,/compatibility-negotiate/u);
  assert.match(harness,/"control_plane_driver_host_admitted": True/u);
  assert.match(harness,/"fixture_process_driver_host_isolated": False/u);
  assert.match(harness,/"technical_state_promoted": False/u);
  assert.match(harness,/"extension_control_plane_driver_host_accepted": True/u);
  assert.match(harness,/"extension_fixture_execution_host_isolation_accepted": False/u);
});
