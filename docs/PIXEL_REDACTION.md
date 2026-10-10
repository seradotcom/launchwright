# R55 — Operator-defined pixel masking with exact Native capture provenance

R55 provides a **measurable, narrow** sanitization step for an owner-authorized source PNG. It replaces operator-specified rectangles with opaque RGB (8,22,33), verifies that **every unmasked RGBA pixel is byte-for-byte unchanged**, decodes and re-encodes a fresh PNG without source metadata, then records a new canonical-Native-dispatched `SANITIZED_DERIVATIVE` evidence resource linked to the exact source capture. It is designed to feed downstream bounded offline demos (R43) and private editorial packages without creating a separate capture backend.

**It does not detect faces, names, addresses, account data, confidential product information or personal information automatically.** It does not independently certify privacy outside the explicit masks, source rights, product behavior or customer permission. Its receipt always reports `technical_state: UNKNOWN`, `all_personal_information_removed: false`, `independent_privacy_review: false` and `platform_authority: false`. The transformation is explicitly marked `changes-observed-state`, so the new evidence is **not** eligible as a direct observed product state.

## Source and permission preconditions

- Use an **existing Launchwright local workspace** with a real, release-bound `CAPTURED_ACTUAL` or `CAPTURED_DEMO_DATA` original Native capture evidence. Imports, generated illustrations and already sanitized descendants cannot be misrepresented as a new original capture.
- The source and release/target/scenario/build must be current and the source approved by the operator. Declared rights must match the original evidence (`owned` or `licensed`).
- Choose the **exact original PNG file** through a private absolute path. It must be a regular, non-symlink 0600 file on POSIX (maximum 12 MiB), fully opaque, dimensions no greater than 3840×2160. The bytes must match the supplied original SHA-256.
- Supply 1–24 explicit masks using integer `x, y, width, height` coordinates. Regions must be non-overlapping, contained inside the exact image, have unique bounded labels and occupy no more than 60% of the image. R55 deliberately fails if the operator attempts to hide almost the entire screen and still call it a useful product walkthrough.
- Independently acknowledge ownership/licensing, the exact masks selected, and that **uncovered personal data may remain**. Do not send protected customer pixels merely to obtain a green CI badge.

## Prepare the input JSON privately

Create an operator-owned JSON file such as `/private/mask-input.json` with 0600 permissions:

```json
{
  "parent_evidence_id": "evidence_ORIGINAL_CAPTURE_ID",
  "source_png_path": "/private/owned-original-screen.png",
  "source_png_sha256": "FULL_64_CHARACTER_SHA256",
  "rights": "owned",
  "rectangles": [
    { "label": "account-field", "x": 160, "y": 90, "width": 110, "height": 35 },
    { "label": "profile-panel", "x": 280, "y": 205, "width": 130, "height": 52 }
  ],
  "acknowledge_source_rights": true,
  "acknowledge_masked_pixels": true,
  "acknowledge_residual_privacy_unknown": true
}
```

You must identify *all* sensitive pixel regions yourself and have permission for the source. The JSON is private and may include a sensitive local filesystem path. R55 uses that path locally, **not** an external server or arbitrary code execution.

## Step 1 — make a deterministic no-effect plan

```sh
node scripts/pixel-mask.mjs plan \
  --state /private/launchwright-state \
  --input /private/mask-input.json \
  --out /private/mask-plan.json
```

Planning reads/decodes the approved PNG, checks its digest, coordinates and current Native capture scope, and calculates the original pixels, masked regions, target PNG SHA, unchanged-outside coverage and exact plan SHA-256. It writes the plan **exclusively** to a new 0600 JSON file, but does not modify Launchwright state or create an output PNG. The saved plan contains only a SHA-256 of the local input path, never the path itself or source screenshot bytes.

## Step 2 — explicitly apply to a private output directory

Choose an **existing real 0700** directory:

```sh
node scripts/pixel-mask.mjs apply \
  --state /private/launchwright-state \
  --input /private/mask-input.json \
  --plan /private/mask-plan.json \
  --output-dir /private/masked-output \
  --confirm-plan FULL_64_CHARACTER_MASK_PLAN_SHA256 \
  --confirm-source FULL_64_CHARACTER_ORIGINAL_PNG_SHA256 \
  --acknowledge-private-write
```

A new RGB PNG and private JSON measurement receipt are created. The canonical Semwright Native SDK application dispatcher records an imported-authority `SANITIZED_DERIVATIVE` capture with `REDACT` transformation, the exact source parent ID, source/release/scenario scope, output SHA-256 and original mask plan. No Host, Platform, GitHub or other external request is executed.

Masks use a **fixed opaque fill**, not a blur; blur can retain recoverable visual context. Pixels outside masks are compared channel-by-channel to the original before writing. All input PNG ancillary metadata is removed by fresh encoding. The output has no alpha channel. This does **not** prove screenshot pixels outside the masks are safe to publish.

## Recovery and conflict rules

- The original file and its SHA must be unchanged. Drift in the source/target/scenario/release record, stale Native source evidence or mask coordinates invalidates the original plan.
- A private, exclusive `.pixel-mask-apply.lock` guards operator application. An unknown stale lock must be reviewed manually before removal.
- If the process crashes after writing the PNG or receipt, rerunning **the same plan** verifies every existing byte and creates only missing files/evidence. The Native evidence receipt must match the exact transformation and origin digest. Conflicts fail closed; nothing is overwritten.
- Human-edited PNGs/receipts, symlinks, public output directories, mismatched rights, nonopaque/invalid PNGs and overlapping/out-of-bounds masks are rejected.

## R55 owned fixture acceptance

The selective `pixel-mask.yml` workflow checks a real disposable Native SDK/SQLite-owned capture/derivative pair, exact PNG pixel comparisons, source PNG metadata stripping, CLI plan/apply, loss/duplicate recovery and runtime privacy boundaries. A real Chromium run takes two explicitly masked synthetic PNGs, revises a legitimate R43 Media plan to reference their **new Native evidence IDs**, navigates the offline viewer using mouse/keyboard at 320/390/768/1280 widths, checks zero external network requests and retains only **redacted synthetic screenshots**, the offline ZIP and the bounded test receipt. The original synthetic PNGs are never uploaded as artifacts.

This synthetic acceptance is useful engineering evidence, not human PII review, real customer capture, canonical Driver Host execution, third-party platform publication or proof of rights across all pixel content. Existing R43/Store/UI consumers still require explicit human review before sharing.
