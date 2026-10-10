# R43 — Private offline interactive walkthrough from sanitized Media evidence

R43 turns **existing Semwright Media plan snapshots** into one navigable, self-contained HTML ZIP. It reuses Launchwright's canonical Native SDK media/capture evidence records, not a second screenshot recorder, browser automation runtime or product application clone.

**What the output is:** a private static walkthrough with screen selectors. It can be navigated by mouse, touch or keyboard and works without network access or JavaScript. **What it is not:** a running customer product, interactive form simulator, functional UX capture validation, automatically sanitized private data, technical PASS or published website.

## Precondition and precise source custody

Use a current Native `media_plan` whose `interactive-demo` variant declares 2–8 shots. Each shot must reference a scoped `SANITIZED_DERIVATIVE` capture Evidence record and its actual parent capture. The source/target/scenario/release, Media variant and declared rights must match the exact Native resource IDs. No path is inferred from a repository or AI request.

For each shot the local operator explicitly selects a private **real PNG** (regular 0600 file on POSIX, 2 MiB limit), its complete SHA-256, a plain-text step label and descriptive alt text. Dimensions must equal the original interactive Media variant, at most 1920 × 1080. The normalized multi-frame bundle has a 12 MiB image-data budget and 21 MiB archive budget.

The package generator decodes and re-encodes PNG pixel data, removing original PNG file metadata/chunks. This **does not redact pixels or independently prove the pixels are private**. The separate checkbox/consent `acknowledge_pixel_privacy` is explicitly an operator declaration, never a privacy-verifier PASS. General facial/personal information, intellectual property, screen tenancy and product truth remain separate manual and canonical gates.

## Exact two-phase operator workflow

Save a private source-selection file (0600) with the following shape, using **real returned Media/Evidence IDs** and existing operator-owned PNG paths:

```json
{
  "media_plan_id": "media_plan_EXACT_ID",
  "variant_id": "interactive_variant_id",
  "source_rights": "owned",
  "acknowledge_private_only": true,
  "acknowledge_pixel_privacy": true,
  "frames": [
    {
      "shot_id": "state_1",
      "source_evidence_id": "evidence_SANITIZED_1",
      "label": "Overview state",
      "alt": "Description of the visual state",
      "png_path": "/private/reviewed-overview.png",
      "png_sha256": "FULL_64_CHARACTER_SHA256"
    },
    {
      "shot_id": "state_2",
      "source_evidence_id": "evidence_SANITIZED_2",
      "label": "Second state",
      "alt": "Description of the second visual state",
      "png_path": "/private/reviewed-next-state.png",
      "png_sha256": "FULL_64_CHARACTER_SHA256"
    }
  ]
}
```

The shot count, order and exact IDs must match the Media plan. If the source declares more shots, include all of them in the same order. The example IDs/hashes above are placeholders, not a valid execution receipt.

First prepare a no-mutation plan:

```sh
node scripts/interactive-demo.mjs plan \
  --state /private/launchwright-state \
  --input /private/screen-selections.json \
  --out /private/offline-demo-plan.json
```

The generated 0600 plan contains the selected Media plan ID/digest, Evidence IDs and image hashes, **not absolute private screenshot paths or original PNG bytes**. It does not create an application object, archive, external task or publication.

Independently verify the 64-character plan SHA and 64-character Media-plan digest. Create a private 0700 destination directory, then explicitly export:

```sh
node scripts/interactive-demo.mjs export \
  --state /private/launchwright-state \
  --input /private/screen-selections.json \
  --plan /private/offline-demo-plan.json \
  --out-dir /private/offline-demo-output \
  --confirm-plan FULL_PLAN_SHA256 \
  --confirm-media FULL_MEDIA_PLAN_DIGEST \
  --acknowledge-private-export
```

R43 writes a ZIP and matching private JSON receipt. The ZIP contains only `index.html`, `manifest.json` and `README.txt`. The HTML embeds the normalized PNG pixels as local data URIs. There are no JavaScript files, external fonts, live links, forms, iframes or source scripts. A strict Content Security Policy disables script/remote execution and permits only hash-pinned inline CSS and embedded PNG pixels.

The exact Media plan, normalized PNG image SHA-256, original screenshot SHA-256, associated Evidence ID, technical UNKNOWN and versioned source digest are retained in the manifest. The Native SDK dispatcher records a Media output with `authority: imported`, `admission: imported-declaration` and `technical_effective: UNKNOWN`, **not** a canonical Semwright Composition/Driver Host execution receipt.

## Safe recovery and limits

The operator CLI and Native workspace enforce a private exclusive export lock. If the process is interrupted after writing some local files, replay the **same exact plan**: unchanged files are verified and reused; only missing files are created. A preexisting modified ZIP/receipt, stale Media dependency, divergent source screenshot, unsafe or symlinked output directory, ambiguous Native output or foreign Evidence fails closed **before overwriting anything**.

An abnormal process kill can leave an exclusive lock. Confirm that no exporter remains active before a human manually removes it. Do not automatically retry another plan or reset source versions to make this work.

The package can be opened from a local file and navigated offline. The supported workflow does not run the source product, reproduce its business logic or prove that transitions are functional. The exact output is a **screen-state tour**, not a Selenium/Playwright executable test.

## Acceptance

The manual R43 CI lane tests deterministic ZIP/PNG output, Native Media receipt custody, rights/source/shot/pixel SHA validation, negative tampering, malformed paths, stale Media pins, injected HTML, output non-clobber and partial recovery. A **real Playwright Chromium** instance opens the generated local HTML, navigates both screens through native radio controls by mouse and keyboard, verifies that injected script execution is blocked by CSP, enables network-offline mode, and checks 320/390/768/1440px layouts. It retains owned synthetic screenshots and bundle/manifest receipts.

These are **synthetic owned sources only**. General customer screenshots, independent privacy inspection, multi-browser acceptance, arbitrary live interactive behavior, Semwright Driver Host/Platform execution and public deployment remain pending under the original master. See [the master capability matrix](../CAPABILITY_MATRIX.md).

**Bounded CI acceptance:** Exact owned synthetic Node24/independent renderer or Chromium results and source SHAs are recorded in [evidence/r43/ci-runs.json](../evidence/r43/ci-runs.json). This is not customer, privacy, publisher-account or Platform authority.


### R55 measured masks as optional input

The R55 operator-owned PNG mask adapter now supplies explicitly
source-bound SANITIZED_DERIVATIVE Evidence and normalized private PNG
files for R43 Media plans to consume. It verifies the changed rectangular
pixels and unchanged outside pixels, but **does not independently detect
personal information in the remaining image**. The viewer's technical
UNKNOWN, private distribution and independent human rights/PII review
requirements are unchanged. See [R55 pixel redaction](PIXEL_REDACTION.md).

R61 can add operator-authored click-through zones to the exact masked R59 bundle; see [OFFLINE_HOTSPOTS.md](OFFLINE_HOTSPOTS.md). Clicks navigate between static captured states and do not establish live product action semantics or privacy beyond operator-selected masks.
