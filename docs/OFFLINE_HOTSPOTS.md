# R61 — Offline click-through on R55 masked Native screenshots

R61 adds operator-authored **clickable screen regions** to the existing R59 offline Media walkthrough. A link only navigates between two immutable masked screenshots; it does **not** reproduce a real application click or prove source-product behavior. No JavaScript, active product scripts, external URLs or Platform Publish are introduced.

## Exact source and prerequisites

Use the same authenticated local Launchwright workspace and the exact private R59 masked-demo plan, original R59 request (including R55 mask plans, screenshot paths and receipts), R59 private ZIP plus its JSON receipt, and the imported/UNKNOWN Native Media output created by R59. The original source files must still be readable.

R61 revalidates R55 mask plans and current derived Evidence, original screenshot pixel hashes, the exact R59 ZIP/manifest/HTML digests, Native media-output ID and revision, Media source freshness, rights and the technical UNKNOWN boundary. Private filesystem paths never enter the saved R61 plan. No additional Native `media_output` is created.

## Bounded operator click-zone definition

Save a private JSON array with one or more links, each with `from_shot_id`, `to_shot_id`, `label`, and pixel-space `x`, `y`, `width`, `height`. Coordinates use the **original masked screenshot dimensions**, not device CSS pixels. Example for the owned synthetic 640×360 test fixture only:

```json
[
  {
    "from_shot_id": "state_1",
    "to_shot_id": "state_2",
    "label": "Open captured second state",
    "x": 420,
    "y": 135,
    "width": 90,
    "height": 70
  },
  {
    "from_shot_id": "state_2",
    "to_shot_id": "state_1",
    "label": "Return to captured first state",
    "x": 420,
    "y": 135,
    "width": 90,
    "height": 70
  }
]
```

All steps must be reachable from the first. Links must connect distinct approved source shots and cannot overlap one another on the same screenshot or **intersect an R55 private masking rectangle**. Rectangles must fit entirely inside the real source image and have minimum size 44×44 source pixels. Max 20 links overall, 3 per screen. On narrower screens the navigation list provides full-sized keyboard/touch targets even if a spatial overlay scales smaller.

## Two-phase private CLI

First prepare a no-effects plan:

```sh
node scripts/offline-hotspots.mjs plan \
  --state /private/launchwright-workspace \
  --r59-plan /private/masked-demo-plan.json \
  --r59-request /private/masked-demo-request.json \
  --r59-dir /private/r59-output \
  --links /private/hotspots.json \
  --out /private/hotspot-plan.json \
  --acknowledge-mask-scope-only \
  --acknowledge-private-only
```

Then independently confirm the complete plan SHA and the **original R59 ZIP SHA-256**. The output folder must be a preexisting real private directory (0700 on POSIX):

```sh
node scripts/offline-hotspots.mjs export \
  --state /private/launchwright-workspace \
  --r59-plan /private/masked-demo-plan.json \
  --r59-request /private/masked-demo-request.json \
  --r59-dir /private/r59-output \
  --links /private/hotspots.json \
  --plan /private/hotspot-plan.json \
  --out-dir /private/hotspot-output \
  --confirm-plan FULL_R61_PLAN_SHA256 \
  --confirm-r59 FULL_ORIGINAL_R59_ZIP_SHA256 \
  --acknowledge-mask-scope-only \
  --acknowledge-private-only \
  --acknowledge-private-export \
  --acknowledge-privacy-outside-masks-unknown
```

The CLI creates one private ZIP and one private receipt; the ZIP contains **only** `index.html`, `manifest.json` and `README.txt`. Extract and open the HTML locally. Each region is a native hash link (`href="#scene-N"`) with keyboard Enter support and a visible focus outline. CSS `:target` switches screens without code execution. The layout keeps exact screenshot aspect ratio so source-pixel geometry aligns on desktop and mobile.

The ZIP manifest contains complete R55 mask lineage, source R59 plan/ZIP/HTML/manifest SHA, original Native media-output ID, exact image hashes and hotspot definitions. ZIP dates are fixed for byte-identical recovery. Existing changed files, symlinks, exposed directories and concurrent exports fail closed. Replay only the same original private plan after an interrupted local write. An R61 result cannot replace the R59 Native receipt or upgrade technical verification.

## Acceptance and remaining limits

Node tests use real owned-synthetic Native SQLite/Media plus R55 opaque masks/R59 bundled screenshots. They check SHA identity, rights, privacy-mask overlap, click geometry, graph reachability, source invalidation, duplicate Media receipt conflict, CLI consent, tampering and idempotent file recovery.

The manual Node24 Chromium lane opens the local file, clicks hotspots, uses keyboard Enter/global navigation, checks pixel geometry and viewport sizes 320/390/768/1440, attempts script injection against CSP, and records **zero network requests**. This is owned-fixture UI acceptance, not an independently verified customer app interaction.

**INTERACTIVE_DEMO remains PARTIAL.** A captured-state link does not prove that clicking the equivalent original interface would produce that state. Privacy outside selected rectangles, customer image rights, real application actions, full accessibility testing, Driver Host execution and Platform Publish remain separately unaccepted.
