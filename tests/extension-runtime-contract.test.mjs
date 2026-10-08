// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const workflow=readFileSync(new URL('../.github/workflows/heavy.yml',import.meta.url),'utf8');
const harness=readFileSync(new URL('../scripts/verify-extension-runtime.py',import.meta.url),'utf8');
const driver=readFileSync(new URL('../crates/launchwright-extension-driver/src/main.rs',import.meta.url),'utf8');
const nativeDriver=readFileSync(new URL('../crates/launchwright-native/src/main.rs',import.meta.url),'utf8');
const runtime=readFileSync(new URL('../src/extension-runtime.mjs',import.meta.url),'utf8');
const semwrightSha='d2da9a495a53fe279a1ca4de61f0e24646350f22';

test('R28 extension lane is exact-SHA Driver Host execution with isolated Native admission',()=>{
  assert.match(workflow,/options: \[all, native, host, verifier, extension, browser,/u);
  assert.match(workflow,/inputs\.lane == 'all' \|\| inputs\.lane == 'extension'/u);
  assert.match(workflow,new RegExp('SEMWRIGHT_SHA: '+semwrightSha,'u'));
  assert.match(workflow,/cargo test -p launchwright-extension-driver/u);
  assert.match(workflow,/cargo build -p launchwright-native -p launchwright-extension-driver/u);
  assert.match(workflow,/verify-extension-runtime\.py/u);
  assert.match(workflow,/LAUNCHWRIGHT_NATIVE_EXTENSION_RUNTIME_BUNDLE_SHA256/u);
  assert.match(workflow,/extension_provider_driver_host_isolation_accepted == true/u);
  assert.match(workflow,/arbitrary_extension_execution == false/u);
  assert.match(workflow,/third_party_extension_execution_authority == false/u);
});

test('R28 provider surface is fixed to owned DeltaRender and DeltaCLI status',()=>{
  assert.match(driver,/include_str!\("\.\.\/\.\.\/\.\.\/fixtures\/deltarender\.mjs"\)/u);
  assert.match(driver,/include_str!\("\.\.\/\.\.\/\.\.\/fixtures\/deltacli\.mjs"\)/u);
  assert.match(driver,/driver\.launchwright-extension\.render/u);
  assert.match(driver,/driver\.launchwright-extension\.cli-status/u);
  assert.match(driver,/node-extension-provider/u);
  assert.match(driver,/RuntimeToolMode::HostMediated/u);
  assert.match(driver,/Extension execution requires an authenticated Driver Host context/u);
  assert.match(driver,/Registered extension digest differs from the provider-pinned fixture source/u);
  assert.match(driver,/vec!\["status"\.into\(\), "--json"\.into\(\)\]/u);
  assert.match(driver,/scope":"owned-deltarender-deltacli-only"/u);
});

test('R28 Native profile isolates extension execution receipts from general extension metadata',()=>{
  assert.match(nativeDriver,/Profile::ExtensionRuntime/u);
  assert.match(nativeDriver,/"node-extension-runtime"/u);
  assert.match(nativeDriver,/Some\("extension-receipts"\)/u);
  assert.match(runtime,/EXTENSION_RUNTIME_PROVIDER='driver:launchwright-extension'/u);
  assert.match(runtime,/EXTENSION_RUNTIME_PROVIDER_VERSION='0\.2\.0-dev\.1'/u);
  assert.match(runtime,/receipt\.command===expectedCommand/u);
  assert.match(runtime,/receipt\.observed_at===data\.finished_at/u);
  assert.match(runtime,/platform_execution_authority===false/u);
  assert.match(runtime,/external_customer_acceptance===false/u);
});

test('R28 acceptance requires negative controls and preserves bounded authority',()=>{
  assert.match(harness,/expected_fixture_sha256": "0" \* 64/u);
  assert.match(harness,/expected_build": "build-B"/u);
  assert.match(harness,/r28-crossed-command\.json/u);
  assert.match(harness,/allow_extension=False/u);
  assert.match(harness,/"arbitrary_extension_execution": False/u);
  assert.match(harness,/"third_party_extension_execution_authority": False/u);
  assert.match(harness,/"mobile_device_execution_authority": False/u);
  assert.match(harness,/"platform_execution_authority": False/u);
  assert.match(harness,/"publication_authority": False/u);
});
