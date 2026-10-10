# R58 — R55 masked pixels to App Store Connect screenshot staging

R58 adds a stricter, operator-selected provenance path for screenshots which R51 can stage on App Store Connect. The exact sequence is:

**R55 original screenshot → explicit opaque rectangular masks → imported Native SANITIZED_DERIVATIVE → R44 Apple iPhone screenshot ZIP → R51 screenshot-set intent.**

No new Native SDK, database or Apple REST client is introduced. The existing R51 adapter handles all HTTPS upload operations and read-only lost-response recovery.

## Actual scope and privacy

R55 now admits Apple portrait dimensions 1179×2556 and 1206×2622. The maximum image height increases to 2700 **without increasing the original 3840×2160 total decoded-pixel memory budget** or 12 MiB compressed PNG cap.

R58 requires one distinct R55 mask/receipt and Native derived Evidence per R44 Apple iPhone screenshot. It verifies the release/build, source rights, Native Evidence revision, mask rectangle count, exact masked PNG SHA-256 and all Apple ZIP pixel contents. The Native derivative retains `semantic_effect: changes-observed-state`, `observed_state_eligible: false`, technical UNKNOWN and Host acceptance NOT_ESTABLISHED. A mask proves only changes inside selected rectangles, **not** that other PII is absent, that the user owns every asset, or that this is a real iPhone device capture.

## Inputs

Create and retain real private R55 mask inputs, plans and receipts following [R55](PIXEL_REDACTION.md). Update the R44 Apple store input screenshots with each R55 masked PNG path/SHA and the corresponding derived Evidence ID. Preserve the original reviewed Candidate, target, locale and rights declaration.

Create a private 0600 JSON file containing exactly these keys: `store_input` (the full R44 input), `masked_sources` (array of objects containing `mask_input`, `mask_plan`, `mask_receipt`), `acknowledge_mask_scope_only: true` and `acknowledge_private_apple_only: true`. This input contains private local paths but **never** JWTs or signed upload URLs.

## 1. Plan without source mutations

```sh
node scripts/masked-apple.mjs plan \
  --state /private/launchwright-state \
  --bundle /private/masked-apple-input.json \
  --out /private/masked-apple-plan.json
```

The plan binds all R55 mask/Native identities to the exact source Candidate and R44 Apple plan. It does not write store files, contact Apple or certify global pixel privacy.

## 2. Export the private masked R44 package

```sh
node scripts/masked-apple.mjs export \
  --state /private/launchwright-state \
  --bundle /private/masked-apple-input.json \
  --plan /private/masked-apple-plan.json \
  --out-dir /private/apple-output \
  --confirm-masked FULL_R58_PLAN_SHA256 \
  --confirm-store FULL_R44_PLAN_SHA256 \
  --confirm-candidate FULL_CANDIDATE_SHA256 \
  --acknowledge-private-export \
  --acknowledge-remaining-privacy-unknown
```

The output directory must already exist as owner-only 0700 on POSIX. R58 uses the real R44 store package writer, reopens its ZIP, compares all normalized pixels to the R55 masked PNG, and writes a private Native-linked proof. Reusing the **same saved plan** can recover incomplete local output without clobbering modified files.

## 3. Prepare the App Store upload intent

```sh
node scripts/masked-apple.mjs apple-plan \
  --state /private/launchwright-state \
  --bundle /private/masked-apple-input.json \
  --plan /private/masked-apple-plan.json \
  --out-dir /private/apple-output \
  --screenshot-set EXISTING_SET_ID \
  --localization EXISTING_VERSION_LOCALIZATION_ID \
  --out /private/apple-upload-intent.json \
  --acknowledge-asset-only
```

This calls R51's original immutable screenshot intent planner, but only after checking the private R58 receipt, PNG ZIP and R55 Native/source claims again. No network call is performed.

## 4. Optional real Apple asset send

An operator with an existing App Store Connect Screenshot Set and a private short-lived JWT file may execute:

```sh
node scripts/masked-apple.mjs send \
  --state /private/launchwright-state \
  --bundle /private/masked-apple-input.json \
  --plan /private/masked-apple-plan.json \
  --out-dir /private/apple-output \
  --intent /private/apple-upload-intent.json \
  --token-file /private/operator-apple.jwt \
  --confirm-masked FULL_R58_PLAN_SHA256 \
  --confirm-apple-intent FULL_R51_INTENT_SHA256 \
  --confirm-candidate FULL_CANDIDATE_SHA256 \
  --confirm-set EXISTING_SET_ID \
  --acknowledge-first-send \
  --out /private/apple-upload-receipt.json
```

If the outcome is unknown, **do not retry send**. Use the original inputs with the `recover` command instead, without `--acknowledge-first-send`. Recovery uses R51 read-only GET state and never duplicates reservations.

R58 does not create API keys, App versions, App Review submissions, public listings, Platform jobs or billing. It does not prove that the App Store policy accepts the screens.

## Acceptance and remaining work

The selective [masked-apple workflow](../.github/workflows/masked-apple.yml) tests actual owned synthetic R55 PNG masking, the Native derivative, R44 ZIP byte/pixel integrity, R51 staged intents and mocked REST PUT/PATCH/recovery with exact consent. Its output contains redacted PNGs and source hashes, **not original unmasked pixels or Apple credentials**. Successful test runs are NOT real App Store Connect account or customer acceptance.

APPLE_UPLOAD remains PARTIAL until actual independently authorized account processing, content/pixel privacy/rights review, device-origin and store policy acceptance are separately established. Full master completion and Platform Publish remain blocked.
