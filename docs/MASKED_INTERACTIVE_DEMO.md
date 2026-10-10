# R59 — Masked Native pixels in an offline interactive walkthrough

R59 connects existing R55 pixel masking to the R43 script-free offline demo. It reuses the **same canonical Semwright Native SDK workspace and Media plan**, and requires **one exact R55 opaque-mask result plus current Native SANITIZED_DERIVATIVE evidence for every navigable screen**.

The outcome is an offline HTML walkthrough ZIP with the exact R55/source/Native mask chain in its manifest and a private receipt. R59 never replays the source application, allows productive authentication, contacts a third party, deploys a website, publishes or upgrades technical verification to PASS.

## Required source and privacy boundary

Before exporting, the operator must already have:

1. An owned/licensed, explicitly authorized original capture Evidence for each Media shot, tied to the correct release, build, scenario and target. A fixture or local `CAPTURED_DEMO_DATA` record is **not** canonical production Host acceptance.
2. A [R55 mask](PIXEL_REDACTION.md) for each original PNG: reviewed opaque rectangles, exact original SHA-256, private redacted PNG, SHA-bound R55 plan, receipt and **Native** derived Evidence. R55 proves mask pixels and all other pixels **unchanged**; it does *not* prove personal data outside those rectangles is absent.
3. A **current R43 Media plan** whose interactive-demo shot order and `interactive_evidence_id` references the **new exact R55 Native derivatives**, not an older declared sanitized screenshot. Update it through the existing versioned `media.revise` operation; do not overwrite the earlier revision.
4. A complete R43 request using **only R55 masked PNG paths and SHA-256s** with `source_evidence_id` equal to the Native derived Evidence ID. Media policy remains `sanitized_only=true`, `productive_auth=false` and `active_source_scripts=false`.
5. A private output directory, owner-only mode 0700 on POSIX. The original source PNG, R55 plan and private paths stay outside the public repository.

R59 compares decoded pixels embedded in the viewer with R55's `masked_pixel_sha256`. It also checks the opaque rectangle proof, source/derived Native IDs and versions, original/masked PNG hashes, rights, parent/derived relationship, Media shot order and exact build/target/scenario identity. A changed source, missing mask, swapped image, stale derivative or conflicting Media receipt **blocks** export.

## Exact private input

Create a private regular JSON file (0600 on POSIX) with this shape:

```json
{
  "demo_input": {
    "...": "Complete R43 media-bound offline-demo input",
    "media_plan_id": "EXACT_REVISED_R43_MEDIA_PLAN_ID",
    "variant_id": "EXACT_INTERACTIVE_DEMO_VARIANT",
    "source_rights": "owned",
    "frames": [
      {
        "shot_id": "first_shot",
        "source_evidence_id": "EXACT_R55_NATIVE_DERIVED_EVIDENCE_ID",
        "label": "Operator-reviewed first state",
        "alt": "Descriptive text for the approved state",
        "png_path": "/private/masks/launchwright-masked-....png",
        "png_sha256": "EXACT_R55_MASKED_PNG_SHA256"
      }
    ],
    "acknowledge_private_only": true,
    "acknowledge_pixel_privacy": true
  },
  "masked_sources": [
    {
      "mask_input": {"...": "Original complete R55 source/mask input"},
      "mask_plan": {"...": "Original saved R55 plan"},
      "mask_receipt": {"...": "Complete R55 Native apply receipt"},
      "masked_png_path": "/private/masks/launchwright-masked-....png"
    }
  ],
  "acknowledge_mask_scope_only": true,
  "acknowledge_private_only": true
}
```

The abbreviated example requires the full [R43 schema](INTERACTIVE_DEMO.md) and R55 contracts; it is not runnable JSON by itself. `masked_sources` must be ordered one-for-one with the R43 `frames` and pinned Media shot order (2–8 frames).

## Prepare without mutations

```sh
node scripts/masked-interactive-demo.mjs plan \
  --state /private/launchwright-state \
  --input /private/masked-demo-request.json \
  --out /private/masked-demo-plan.json
```

The plan contains Media and R55/Native digest/ID/version bindings plus SHA-256 of private paths, **not original paths or screenshot bytes**. It is written exclusively (0600). Planning does not write a Media output, execute the customer's project or contact any network.

## Explicit export to private folder

```sh
node scripts/masked-interactive-demo.mjs export \
  --state /private/launchwright-state \
  --input /private/masked-demo-request.json \
  --plan /private/masked-demo-plan.json \
  --out-dir /private/masked-demo-review \
  --confirm-plan EXACT_R59_PLAN_SHA256 \
  --confirm-media EXACT_MEDIA_PLAN_DIGEST \
  --acknowledge-private-export \
  --acknowledge-remaining-privacy-unknown
```

The output contains `launchwright-masked-demo-PLANPREFIX.zip` and its private receipt. The ZIP contains only `index.html`, `manifest.json` and `README.txt`. The original R43 HTML is script-free, embeds masked PNG data URIs, enables native radio/keyboard navigation and enforces restrictive Content Security Policy. R59 adds the R55/Native source chain to the manifest, **without inserting scripts or unmasked images**.

The locked Native `media.output_record` operation records the ZIP as an **imported-declaration, technical UNKNOWN**, not successful Semwright Composition/Driver Host execution. R59 shares R43's `.interactive-demo-apply.lock` and checks Native output conflicts **before writing files**. An incomplete export can resume with the same exact plan; conflicting bytes, altered masks or a stale lock require human reconciliation and are never overwritten.

## Real owned-fixture tests and external limits

R59's selective `masked-demo` heavy CI lane produces two real R55 masked PNGs from *owned synthetic 640×360 fixture data*, persists current Native derivatives, revises the same Media plan to reference them, then exports a private ZIP. Actual Chromium navigates at 320, 390, 768 and 1440 px, checks keyboard controls, CSP denial of injected scripts, displayed pixel hashes and zero HTTP requests. The CI run retains ZIP, screenshot previews and exact receipts.

That proves **selected rectangular masking and Native source linkage**, not generalized privacy, semantic fidelity, accessibility certification, a customer session, real device origin, real product interactions or Semwright Platform Publish. A static walkthrough does not prove that controls in the actual product operate correctly.

The master `INTERACTIVE_DEMO` profile remains **PARTIAL** and the whole-master gate remains **BLOCKED**.
