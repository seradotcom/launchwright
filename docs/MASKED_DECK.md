# R57 — R55 masked screenshot to editable deck and PDF

This workflow consumes **one R42 human-reviewed, frozen Markdown candidate**
and exactly one separate R55 masked screenshot per content section (1–7).
It produces an editable PPTX, independent real PDF and SHA-256 receipt.
Every screenshot binds the original R55 plan/receipt, exact PNG bytes,
decoded pixels, R55 Native SANITIZED_DERIVATIVE Evidence and source revision.

**The mask scope is not general pixel privacy clearance.** Unmasked
pixels are unchanged, not independently reviewed. Rights and visual
privacy acknowledgements are operator declarations; technical state remains
UNKNOWN and no customer/Platform/Host or publication rights are inferred.

## Source requirements

The frozen candidate must have a recent APPROVED_EDITORIAL decision.
Each R55 input/plan/receipt must correspond to a persisted Native
pixel-mask derivative from the same release, target and build. Changes to
Native evidence, source PNG, masked bytes, source release or candidate
invalidate the entire R57 plan. Exactly one distinct image is required
for every Markdown content slide.

Build a private JSON file with these fields:

- deck: complete R42 planning options including candidate_id, artifact_id,
  acknowledge_draft_only=true, acknowledge_unverified=true
- screenshots: ordered array of records, each containing mask_input,
  mask_plan, mask_receipt and masked_png_path from one exact R55 export
- acknowledge_mask_scope_only=true
- acknowledge_private_deck_only=true

This JSON includes local private source file paths; never commit or publish it.

## Two-phase operator usage

```sh
node scripts/masked-deck.mjs plan \
  --state /private/launchwright-state \
  --input /private/masked-deck-input.json \
  --out /private/masked-deck-plan.json

node scripts/masked-deck.mjs export \
  --state /private/launchwright-state \
  --input /private/masked-deck-input.json \
  --plan /private/masked-deck-plan.json \
  --out-dir /private/output-0700 \
  --confirm-plan FULL_PLAN_SHA256 \
  --confirm-candidate FULL_CANDIDATE_SHA256 \
  --approve-export
```

Plans are created exclusively as mode 0600 on POSIX. Output directories
must already be private (0700). The plan contains only digests/identifiers
and hashes of private paths, not raw path strings. Export revalidates
all source evidence, every R55 mask and frozen Markdown, then writes
a real editable PPTX, a matching PDF and one source-linked JSON receipt.

Recovery requires the SAME exact plan; modified existing outputs,
concurrent writers, changed Native revisions and missing acknowledgements
fail closed rather than overwriting another editor's files.

## Acceptance limits

The owned synthetic R57 CI lane uses the real Semwright Native SDK,
R55 PNG pixel masks, two independent source screenshots and one reviewed
candidate. It renders both documents, verifies editable PNG media within
PPTX and embedded PDF images, converts the PPTX via LibreOffice,
renders both PDFs via Poppler and retains screenshots plus digests.

This only establishes owned-fixture output conformance, not
independent general privacy, accessibility, visual design-quality,
customer source rights, external publication or canonical Platform
execution. DECK_PDF remains PARTIAL.
