# R67 — Two-release continuity inside the Launchwright local web UI

**Scope: operator-private view of the existing R54 Native SDK-backed continuity engine.**
This feature does NOT start a source application, infer technical verification,
copy an old build's outputs into a newer build, or publish anything externally.
It cannot make the original master 196/196 complete.

## Workflow

1. Start the local owner workspace using `node src/main.mjs serve --state /private/state --port 4317`, open the browser, and unlock with its owner token.
2. Navigate to **Release continuity**. Select two *different* releases of the same product and one frozen candidate for each release. Declare private-use and incomplete-evidence acknowledgement.
3. Click **Prepare exact plan**. This calls the R54 Native state projection, performs no workspace mutation or export, and shows the SHA-256 for the plan and each candidate.
4. Click **Export private ZIP**, independently type each full SHA-256 and consent. The server invokes `exportReleaseContinuity` under its exclusive R54 lock and places the deterministic ZIP and JSON receipt under `<state>/.local-continuity-exports/` (0700 folder, 0600 files). It never accepts browser-supplied server paths.
5. Download using the local owner-only URL. The server opens files without following symlinks and checks exact plan and archive digests before returning bytes.
6. If an HTTP response disappears, use **Check original export status** or **Recover existing export by full plan SHA**. These are GET reads; no automatic export replay or duplicate publication. To explicitly finish a partial export, re-submit the same plan and confirmations, as documented by R54.

Browser plans live only in the current tab's in-memory UI state, **not** in localStorage. After a tab restart, the exact plan SHA can recover a completed export from the server's private folder. A missing, partially completed or edited export does not get silently treated as valid. Network failures must not prompt a new plan/send without operator review.

## HTTP routes (owner-only)

- `POST /api/v1/local-continuity/plan`: exact `{before_release_id, after_release_id, before_candidate_id, after_candidate_id, acknowledge_private_only:true, acknowledge_incomplete_coverage:true}`. Returns unchanged R54 plan; no file writes.
- `POST /api/v1/local-continuity/export`: `{plan, confirm_plan_sha256, confirm_before_candidate_sha256, confirm_after_candidate_sha256, acknowledge_private_export:true}`. Returns a private export receipt and local download URL. The R54 plan is reverified against current Native state.
- `GET /api/v1/local-continuity/<64-hex-plan-sha>/status`: returns `ABSENT` or fully verified `READY`; partial or tampered files cause `Conflict`.
- `GET /api/v1/local-continuity/<64-hex-plan-sha>/bundle.zip`: owner-only ZIP bytes with SHA-derived ETag and `Cache-Control: no-store`.

Routes reject consumer bearer credentials, missing authorization, unexpected fields and cross-origin requests. HTML escapes product/release/candidate names and never inserts executable product code.

## Evidence boundary and tests

Use the Node 24 Linux/Windows/macOS `Application checks` matrix for owned local service regressions, and the selective **R67 owned browser continuity acceptance** workflow for Chromium and four responsive widths. Both use synthetic release data, real current Launchwright Native state, and the existing R54 report/ZIP renderer. Source and official CI results must be bound to the exact PR SHA; code present without passing CI is not acceptance.

**Still BLOCKED**: real customer capture, independent product-behavior equivalence, holistic pixel PII/rights review, canonical Semwright Platform Publish deployment and externally hosted release approval. Technical truth remains `UNKNOWN`.
