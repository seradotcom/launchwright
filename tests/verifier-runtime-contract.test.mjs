// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow=readFileSync(new URL('../.github/workflows/heavy.yml',import.meta.url),'utf8');
const harness=readFileSync(new URL('../scripts/verify-verifier-runtime.py',import.meta.url),'utf8');
const nativeHostHarness=readFileSync(new URL('../scripts/verify-native-host.py',import.meta.url),'utf8');
const driver=readFileSync(new URL('../crates/launchwright-verifier-driver/src/main.rs',import.meta.url),'utf8');
const runtime=readFileSync(new URL('../src/verification-runtime.mjs',import.meta.url),'utf8');
const verifierEntry=readFileSync(new URL('../src/native-verifier-entry.mjs',import.meta.url),'utf8');
const nativeDriver=readFileSync(new URL('../crates/launchwright-native/src/main.rs',import.meta.url),'utf8');
const lock=JSON.parse(readFileSync(new URL('../SOURCE_LOCK.json',import.meta.url),'utf8'));
const semwrightSha='d2da9a495a53fe279a1ca4de61f0e24646350f22';

test('R26 verifier lane is exact-SHA and uses real Driver Host plus Native SDK',()=>{
  assert.equal(lock.native_sdk.sha,semwrightSha);
  assert.match(workflow,/inputs\.lane == 'all' \|\| inputs\.lane == 'verifier'/u);
  assert.match(workflow,new RegExp('SEMWRIGHT_SHA: '+semwrightSha,'u'));
  assert.match(workflow,/cargo test -p launchwright-verifier-driver/u);
  assert.match(workflow,/cargo build -p launchwright-native -p launchwright-verifier-driver/u);
  assert.match(workflow,/verify-verifier-runtime\.py/u);
  assert.match(workflow,/SEMWRIGHT_TEST_DRIVER_SANDBOX: '1'/u);
  assert.match(workflow,/canonical_verifier_runtime_admitted == true/u);
  assert.match(workflow,/platform_execution_authority == false/u);
  assert.match(workflow,/external_customer_acceptance == false/u);
});

test('R26 provider is bounded read-only format verification with a conformance probe',()=>{
  assert.match(driver,/driver\.launchwright-verifier\.format/u);
  assert.match(driver,/driver\.launchwright-verifier\.probe/u);
  assert.match(driver,/workspace_mount\("verification-input"\)/u);
  assert.match(driver,/MAX_ARTIFACT_BYTES/u);
  assert.match(driver,/MAX_TOTAL_BYTES/u);
  assert.match(driver,/file_type\(\)\.is_symlink/u);
  assert.match(driver,/canonical\.starts_with\(&root\)/u);
  assert.match(driver,/Risk::ReadOnly/u);
  assert.match(driver,/dry_run: true/u);
  assert.match(driver,/owner-staged-format-and-credential-patterns-only/u);
});

test('R26 canonical admission reads pinned bytes from a separate Host mount',()=>{
  assert.match(verifierEntry,/verificationReceiptRoot:paths\.output_root/u);
  assert.match(nativeDriver,/"node-verifier"/u);
  assert.match(nativeDriver,/Some\("verification-receipts"\)/u);
  assert.match(harness,/"launchwright-verifier-node"/u);
  assert.match(nativeHostHarness,/"name": "node-verifier"/u);
  assert.match(nativeHostHarness,/"mounts": \["launchwright-data", "verification-receipts"\]/u);
  assert.match(runtime,/realpathSync\(root\)/u);
  assert.match(runtime,/isSymbolicLink/u);
  assert.match(runtime,/observed===reference\.sha256/u);
  assert.match(runtime,/VERIFIER_PROVIDER='driver:launchwright-verifier'/u);
  assert.match(runtime,/candidateManifestDigest/u);
  assert.match(runtime,/Canonical verification must cover every frozen candidate artifact/u);
  assert.match(runtime,/platform_execution_authority===false/u);
  assert.match(runtime,/external_customer_acceptance===false/u);
});

test('R26 CI proves Broker policy, Driver Host provenance and substitution rejection',()=>{
  assert.match(harness,/"driver",\s*"conformance"/u);
  assert.match(harness,/driver\.launchwright-verifier\.format/u);
  assert.match(harness,/provenance\.get\("provider"\) != "driver:launchwright-verifier"/u);
  assert.match(harness,/ARTIFACT_DIGEST_MISMATCH/u);
  assert.match(harness,/candidate_sha256"\] = "0" \* 64/u);
  assert.match(harness,/allow_verifier=False/u);
  assert.match(harness,/"platform_execution_authority": False/u);
  assert.match(harness,/"external_customer_acceptance": False/u);
  assert.match(harness,/"semantic_authority": False/u);
  assert.match(harness,/"publication_authority": False/u);
});


test('R30 uses a separate bounded credential command without fabricating general privacy authority',()=>{
  assert.match(driver,/CREDENTIAL_COMMAND: &str = "driver\.launchwright-verifier\.credential-exposure"/u);
  assert.match(driver,/credential_capability\(\)/u);
  assert.match(driver,/inspect_credentials\(&mime, &bytes, &id, &mut findings\)/u);
  assert.match(driver,/CREDENTIAL_UNSUPPORTED_MIME/u);
  assert.match(driver,/CREDENTIAL_GITHUB_TOKEN/u);
  assert.match(driver,/Potential credential marker found; inspect the original privately/u);
  assert.match(runtime,/\['format','credential-exposure'\]/u);
  assert.match(runtime,/owner-granted-driver-host-text-credential-patterns-only/u);
  assert.match(harness,/credential_pattern_scan_admitted/u);
  assert.match(harness,/secret_finding_redacted/u);
  assert.match(harness,/"provider_version": provenance\["provider_version"\]/u);
  assert.match(harness,/provenance\.get\("provider_version"\) != manifest_version/u);
  assert.match(harness,/cross_dimension_rejected/u);
  assert.match(workflow,/general_privacy_authority == false/u);
});
