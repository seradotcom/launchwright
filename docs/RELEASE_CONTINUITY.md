# R54 — Private two-release continuity dossier

R54 compares two **distinct releases of the same Launchwright product**, each with an exact frozen candidate, using the existing Semwright Native SDK local application state. This implements a bounded part of the master requirement for version-aware iterative release materials without treating local comparison as external customer/product verification.

The result is a source-linked, reproducible, operator-private **offline review ZIP** containing a real HTML document, a structured JSON report and a README. The report explains which registered artifact slots were added, removed, changed or unchanged; whether editorial copy is identical even though release-bound output bytes differ; and which claims, scenarios, source pins, channel outcomes and Project Graph coverage remain unknown.

**It does not automatically reuse old outputs, prove feature behavior, execute the product, publish any release or invoke Semwright Platform.** The old candidate and historical release are never edited.

## Selection and trust boundary

Choose the product's historical and current release IDs and their frozen candidate IDs. The application verifies both candidates belong to their stated releases and that both releases belong to the same product, have distinct build labels and use 1–32 artifacts each. Every candidate must retain a fresh exact source revision and every artifact must match its frozen manifest, source pins, byte length and SHA-256. If a historical source was subsequently edited or deleted, **R54 stops**; it never substitutes today's copy into yesterday's candidate.

Artifacts are compared by a semantic slot consisting of the declared target name, editorial locale, target role/plan/region, deliverable title and format. A duplicated slot is ambiguous and rejected. When two output SHA hashes differ but their plain editorial text SHA hashes match, the report identifies that distinction without declaring unchanged behavior. A copied source, localization or image is not automatically approved for reuse merely because text hashes match.

The report includes the Native app's registered-only `release.coverage`, `release.impact`, `candidate.inspect` and channel status projections, but never rewrites unknown evidence as PASS. An accepted candidate.review is editorial approval, not a technical or publication receipt.

## Step 1: prepare, with no application or external mutation

```sh
node scripts/release-continuity.mjs plan \
  --state /private/launchwright-state \
  --before-release OLD_RELEASE_ID \
  --after-release NEW_RELEASE_ID \
  --before-candidate OLD_FROZEN_CANDIDATE_ID \
  --after-candidate NEW_FROZEN_CANDIDATE_ID \
  --out /private/two-release-plan.json \
  --acknowledge-private \
  --acknowledge-incomplete
```

The plan is written exclusively to an operator-chosen private JSON file (mode 0600 on POSIX), without overwriting existing plans. It holds the candidate IDs/SHA-256s, source report digest, four change counts and explicit non-publication flags, **not raw source copy**.

## Step 2: exact private export

Create a private output directory (0700 on POSIX) and independently confirm all three SHA-256 values from the plan:

```sh
node scripts/release-continuity.mjs export \
  --state /private/launchwright-state \
  --plan /private/two-release-plan.json \
  --out-dir /private/continuity-review \
  --confirm-plan EXACT_PLAN_SHA256 \
  --confirm-before EXACT_BEFORE_CANDIDATE_SHA256 \
  --confirm-after EXACT_AFTER_CANDIDATE_SHA256 \
  --acknowledge-export
```

The operator receives a ZIP and receipt. Open `index.html` from inside the ZIP **after extracting it to a private location**. The review HTML is self-contained with a strict CSP forbidding scripts, frames, external fonts, images and network connections. It renders a comparison table, candidate/impact coverage and a permanent technical-unknown warning without external dependencies.

The export is deterministic, keyed to the immutable plan. An interrupted local write can be resumed using the **same** plan: existing ZIP and receipt bytes must match the independently regenerated SHA-256. No edited file, symlink output directory or competing operator lock is silently overwritten. Nothing contacts a third-party service.

## Real owned fixture acceptance

The separate `continuity.yml` manual GitHub Actions workflow validates an actual two-release synthetic Native SDK/SQLite workspace: release A with notes and a retired migration notice, release B with the same original editorial note and a new API guide, plus human editorial reviews of both frozen candidates. It verifies the report identifies **1 changed, 1 added, 1 removed** artifact, and that the changed notes retain the same editorial copy SHA while their release-bound rendered bytes differ. It then tests the real offline package through Chromium at 1440, 768, 390 and 320 px, with no JavaScript, failed requests or horizontal page overflow. ZIP artifacts, hashes and screenshots are retained by exact source SHA.

These tests establish **owned synthetic longitudinal release continuity only**. The original 196-requirement master still has incomplete E2E acceptance, real customer source/capture authorization, independent rights/privacy/semantics/WCAG acceptance, Semwright Platform Publish and external account scopes outstanding. R54 does not increase the publicly linked 21/36 scenario denominator by assertion.
