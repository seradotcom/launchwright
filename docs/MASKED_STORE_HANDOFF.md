# R56 — Exact masked screenshots to Google Play store assets

R56 binds the existing **R55 pixel masks and Native SANITIZED_DERIVATIVE receipts** to the exact PNG screenshots that R44 packages for a Google Play phone listing. It does not replace R44, R52, Native capture, or Semwright Platform. The result is an additional private source-chain receipt, not a declaration that an entire product or screenshot is private/safe.

## Requirements and trust

- Profile: Google Play phone portrait **1080 × 1920**, 2–8 screenshot slots. Apple's larger device heights remain outside this R55 size subset.
- A fresh R44 Candidate/Target/Channel, approved editorial state, explicit operator rights and store listing copy, plus independently supplied icon and feature image.
- For **each** store screenshot: the exact original R55 mask input, SHA-bound plan, apply receipt and current Native derived Evidence. The R44 screenshot must use the R55 masked PNG path/SHA and its returned Native derived Evidence ID, in the same order.
- R55 proves only that the supplied pixel rectangles are opaque and all pixels outside remain unchanged. It does not independently prove removal of other PII, initial device image origin, rights, source app execution, accessibility or marketing graphic safety.
- Original PNG paths and source plans are sensitive. Save private JSON with 0600 permissions (POSIX); never commit it into this repository.

## Operator workflow

Construct a private JSON containing the **complete** original R44 Google Play input and an equal-length array of original R55 sources:

```json
{
  "store_input": {
    "...": "complete original R44 Google Play phone input",
    "screenshots": [
      {
        "source_evidence_id": "EXACT_R55_DERIVED_EVIDENCE_ID",
        "png": {
          "path": "/private/masked/launchwright-masked-PLANPREFIX.png",
          "sha256": "EXACT_R55_MASKED_PNG_SHA256"
        },
        "alt": "Operator-reviewed screenshot description"
      }
    ]
  },
  "masked_sources": [
    {
      "mask_input": {"...": "original saved R55 input"},
      "mask_plan": {"...": "original saved R55 plan"},
      "mask_receipt": {"...": "complete R55 apply receipt"}
    }
  ],
  "acknowledge_mask_scope_only": true,
  "acknowledge_private_store_only": true
}
```

The actual store input must contain all R44 required metadata and graphics; the abbreviated JSON above shows only the handoff contract.

**Prepare without side effects:**

```sh
node scripts/masked-store-handoff.mjs plan \
  --state /private/launchwright-state \
  --input /private/masked-google-input.json \
  --out /private/masked-google-plan.json
```

The private plan binds the R44 plan/candidate SHA-256, R55 mask plans, Native derivative IDs/versions, original source hashes, redacted PNG/pixel hashes, unchanged-region proofs, release/build, and source rights. It contains no original PNG bytes or local paths.

**Explicitly export into an existing private 0700 directory:**

```sh
node scripts/masked-store-handoff.mjs export \
  --state /private/launchwright-state \
  --input /private/masked-google-input.json \
  --plan /private/masked-google-plan.json \
  --out-dir /private/masked-google-review \
  --confirm-handoff FULL_R56_PLAN_SHA256 \
  --confirm-store FULL_R44_PLAN_SHA256 \
  --confirm-candidate FULL_CANDIDATE_SHA256 \
  --acknowledge-private-export \
  --acknowledge-remaining-privacy-unknown
```

R44 creates its genuine local store ZIP and own receipt. R56 writes a third private receipt linking the exact mask source chain to the **R44 ZIP SHA-256**. Existing ZIP and receipts are checked byte-for-byte and never clobbered. After interruption, replay only the *same* original SHA-bound plan. Existing conflicting Native media/rights/branch revisions, unsafe output directories or abandoned writer locks fail closed.

## Relationship to R52 Google Play Edit staging

The R56 ZIP is readable by the existing R52 `prepareGooglePlayStaging` function, which separately validates all four asset groups (screenshots, icon, feature graphic). R56 itself does **not** create an Edit, access a Google account, perform any media upload, commit or publish. R52 retains its own independent operator authorization and recover-only restrictions.

## Owned acceptance and limits

The owned fixture runs real R55 rectangular masking on synthetic 1080 × 1920 images, creates Native sanitized derivative evidence, packages it through R44 and runs R52 prepare-only. The pixel test checks the entire four-channel image against the original plus explicit opaque rectangles, proving all unmasked pixels stay identical. It also tests wrong evidence, swapped screenshots, revised Native state, changed file bytes, denied acknowledgements, wrong rights, concurrent locks and exact CLI/recovery.

This narrows one SOURCE-to-STORE integrity gap. It **does not** independently bind the original device/capture PNG to canonical Driver Host execution, detect personal data outside selected masks, certify app icon/feature graphic privacy, authorize a real customer product or complete the master. Master status remains BLOCKED.
