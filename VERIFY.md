# Reproducible verification — source and authority levels

Minimum supported runtime: **Node 24.21.x**; local Node 22 runs are supplemental only.

## Local explicit verification

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm audit --omit=dev --audit-level=high
npm test
node scripts/verify.mjs
node scripts/master-acceptance.mjs --check
node scripts/acceptance-launcher.mjs list
node scripts/acceptance-launcher.mjs run light
node scripts/clean-room.mjs
```

`master-acceptance --check` validates the original 196 public
requirement identifiers, 36 master scenario denominator, 18 profile slots,
SDK pin and evidence boundaries. It prints BLOCKED honestly while CORE and
external gates remain outstanding. `--require-complete` exits 2
until genuinely all necessary evidence exists; do not suppress that exit.

For the real local UI use the selected browser lane (Playwright Chromium and
runner prerequisites required). The real browser acceptance executes a
synthetic owned app and is not external product, customer or ChatGPT host
acceptance.

## Heavy authorized runners

Manual .github/workflows/heavy.yml supports browser, masked-demo, native, host, verifier,
extension, effects, composition, deltadesk, godot and stress. Dispatch **only
affected** lanes at the exact reviewed Git ref; record the run/job/artifact IDs
and source SHA before assigning any supported-engine or Host acceptance.
Heavy media/Rust/Browser jobs belong on disposable GitHub runners, not the
storage-limited workstation.

The optional source-transfer workflow produces a ZIP and SHA-256 for one
**committed Git tree** with secrets/caches excluded by path; it does not
publish a GitHub Release. Inspect the manifest and checksum before use.
No PRIVATE master ZIP or full operator-specific configuration is included.

## Levels that must not be collapsed

SOURCE_IMPLEMENTED != NODE24_TESTED != NATIVE_ACCEPTED !=
DRIVER_HOST_ACCEPTED != CHATGPT_HOST_ACCEPTED !=
CUSTOMER_PILOT_ACCEPTED != PLATFORM_PUBLISH_ACCEPTED.

See CAPABILITY_MATRIX.md, ACCEPTANCE_REPORT.json, docs/ACCEPTANCE.md and
evidence/rNN/ci-runs.json. The master itself remains blocked on listed
unimplemented or externally unaccepted profiles.
