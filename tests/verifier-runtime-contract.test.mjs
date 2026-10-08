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

test('R30 verifier lane is exact-SHA and uses real Driver Host plus Native SDK',()=>{
  assert.equal(lock.native_sdk.sha,semwrightSha);
  assert.match(workflow,/inputs\.lane == 'all' \|\| inputs\.lane == 'verifier'/u);
  assert.match(workflow,new RegExp('SEMWRIGHT_SHA: '+semwrightSha,'u'));
  assert.match(workflow,/cargo test -p launchwright-verifier-driver/u);
  assert.match(workflow,/cargo build -p launchwright-native -p launchwright-verifier-driver/u);
  assert.match(workflow,/verify-verifier-runtime\.py/u);
  assert.match(workflow,/SEMWRIGHT_TEST_DRIVER_SANDBOX: '1'/u);
  assert.match(workflow,/canonical_verifier_runtime_admitted == true/u);
  assert.match(workflow,/canonical_dimensions_admitted/u);
  assert.match(workflow,/candidate_snapshot_digest_rejected == true/u);
  assert.match(workflow,/dimension_negative_controls_passed == true/u);
  assert.match(workflow,/privacy_compliance_authority == false/u);
  assert.match(workflow,/legal_rights_authority == false/u);
  assert.match(workflow,/wcag_conformance_authority == false/u);
  assert.match(workflow,/platform_execution_authority == false/u);
  assert.match(workflow,/external_customer_acceptance == false/u);
});

test('R30 provider exposes only four bounded deterministic dimensions plus a probe',()=>{
  assert.match(driver,/driver\.launchwright-verifier\.format/u);
  assert.match(driver,/driver\.launchwright-verifier\.probe/u);
  assert.match(driver,/workspace_mount\("verification-input"\)/u);
  assert.match(driver,/MAX_ARTIFACT_BYTES/u);
  assert.match(driver,/MAX_TOTAL_BYTES/u);
  assert.match(driver,/file_type\(\)\.is_symlink/u);
  assert.match(driver,/canonical\.starts_with\(&root\)/u);
  assert.match(driver,/Risk::ReadOnly/u);
  assert.match(driver,/dry_run: true/u);
  assert.match(driver,/owner-staged-bounded-verifier-dimensions/u);
  for(const dimension of ['format','privacy','rights','accessibility'])assert.match(driver,new RegExp('driver\.launchwright-verifier\.'+dimension,'u'));
  assert.match(driver,/launchwright-verifier-input\/2/u);
  assert.match(driver,/launchwright-verifier-result\/2/u);
  assert.match(driver,/exact_request_digest/u);
});

test('R30 canonical admission keeps dimension-specific scope on a separate Host receipt mount',()=>{
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
  assert.match(runtime,/VERIFIER_SCOPES/u);
  assert.match(runtime,/artifact-secret-patterns-only/u);
  assert.match(runtime,/frozen-rights-declarations-only/u);
  assert.match(runtime,/html-static-structure-only/u);
  assert.match(runtime,/Canonical verification must cover every frozen candidate artifact/u);
  assert.match(runtime,/platform_execution_authority===false/u);
  assert.match(runtime,/external_customer_acceptance===false/u);
});

test('R30 CI proves Broker policy, exact snapshot binding and bounded negative controls',()=>{
  assert.match(harness,/"driver",\s*"conformance"/u);
  assert.match(harness,/DIMENSIONS = \("format", "privacy", "rights", "accessibility"\)/u);
  assert.match(harness,/driver\.launchwright-verifier\.\{dimension\}/u);
  assert.match(harness,/provenance\.get\("provider"\) != "driver:launchwright-verifier"/u);
  assert.match(harness,/ARTIFACT_DIGEST_MISMATCH/u);
  assert.match(harness,/candidate_snapshot_digest_rejected/u);
  assert.match(harness,/PRIVACY_SECRET_PATTERN/u);
  assert.match(harness,/ACCESSIBILITY_HTML_LANG/u);
  assert.match(harness,/RIGHTS_RESTRICTED/u);
  assert.match(harness,/candidate-inspect/u);
  assert.match(harness,/candidate verification gate did not resolve every required bounded dimension to PASS/u);
  assert.match(harness,/candidate_sha256"\] = "0" \* 64/u);
  assert.match(harness,/allow_verifier=False/u);
  assert.match(harness,/"platform_execution_authority": False/u);
  assert.match(harness,/"external_customer_acceptance": False/u);
  assert.match(harness,/"semantic_authority": False/u);
  assert.match(harness,/"privacy_compliance_authority": False/u);
  assert.match(harness,/"legal_rights_authority": False/u);
  assert.match(harness,/"wcag_conformance_authority": False/u);
  assert.match(harness,/"publication_authority": False/u);
});
