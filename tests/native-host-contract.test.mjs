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
  assert.match(workflow,/options: \[all, native, host, verifier, browser,/u);
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

test('R22 Host harness preserves canonical Effects custody without manufacturing admission',()=>{
  assert.match(workflow,/semwright-native-effects/u);
  assert.match(harness,/effects_host_custody_flow/u);
  assert.match(harness,/canonical Effects readback result through Driver Host without inventing admission/u);
  assert.match(harness,/"effects.record"/u);
  assert.match(harness,/"effects-inspect"/u);
  assert.match(harness,/"canonical-result-not-admitted"/u);
  assert.match(harness,/"effective_launchwright_state": "UNKNOWN"/u);
  assert.match(harness,/"owner_admission_rejected": True/u);
  assert.match(harness,/"canonical_reader_execution_inside_driver_host": False/u);
  assert.match(harness,/"effects_canonical_readback_host_custody_accepted": True/u);
  assert.match(harness,/"effects_owner_admission_accepted": False/u);
  assert.match(harness,/"effects_evaluation_driver_host_isolation_accepted": False/u);
  assert.match(harness,/"effects_execution_authority": False/u);
  assert.match(workflow,/effects_canonical_readback_host_custody_accepted == true/u);
  assert.match(workflow,/effects_owner_admission_accepted == false/u);
});

test('R21 Host harness executes canonical Project Graph and records the bounded Native projection',()=>{
  assert.match(harness,/allow_project_graph/u);
  assert.match(harness,/project-graph-fixture/u);
  assert.match(harness,/project_graph_host_flow/u);
  assert.match(harness,/project\.create/u);
  assert.match(harness,/project\.asset\.register/u);
  assert.match(harness,/project\.edge\.declare/u);
  assert.match(harness,/project\.query/u);
  assert.match(harness,/project\.impact/u);
  assert.match(harness,/project\.manifest\.export/u);
  assert.match(harness,/graph-observation_record/u);
  assert.match(harness,/"broker_project_graph_live": True/u);
  assert.match(harness,/"native_driver_projection_recorded": True/u);
  assert.match(harness,/"project_graph_live_broker_admitted": True/u);
  assert.match(harness,/"project_graph_native_projection_recorded": True/u);
  assert.match(harness,/"project_graph_platform_job_authority": False/u);
  assert.match(harness,/"denominator_complete": False/u);
  assert.match(harness,/"scope_partial": bool\(page\["scope_partial"\]\)/u);
  assert.match(harness,/file-scoped query did not preserve its partial-scope marker/u);
  assert.match(harness,/project_graph_denied_flow/u);
});
