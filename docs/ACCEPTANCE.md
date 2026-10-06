# Acceptance ledger

This ledger separates implemented behavior from execution evidence. A PASS belongs to an exact SHA, environment and lane; it is never inherited from another commit.

## Supplemental workstation checks

Supplemental workstation pass for this branch:

- Node: 22.22.0 — **outside** the Native SDK supported engine.
- `npm test`: **160 passed, 0 failed, 0 skipped** on the current R9 canonical-graph branch. Exact TAP output is retained in `evidence/r9/local-test.tap`; this local run is supplemental because Node 22.22.0 is outside the supported engine. The 11 new Graph tests cover authority separation, private-node rejection, bounded cycle reports, UNKNOWN frontier preservation, exact observed-edge admission, cache identity dimensions, revision-preserving coalescing and mandatory finalization.
- `node scripts/verify.mjs`: source-lock integrity and syntax PASS; **84 JavaScript modules and 82 Native driver operations** checked. Current output is retained in `evidence/r9/verify.json`.
- Native profile build: **82/82 public operations assigned exactly once** across nine compacted canonical bridge bundles. Exact local sizes are core **46,007**, production **42,528**, review **47,219**, integrations **34,179**, extensions **42,597**, work **42,156**, media **39,969**, publish **48,469**, graph **48,166** bytes. Graph authority-sensitive operations were moved out of general production rather than weakening the canonical 48 KiB limit; `publish` is tightest with 683 bytes of headroom and `graph` has 986 bytes. Exact manifest and build log are retained in `evidence/r9/native-bundle.json` and `evidence/r9/native-bundle-build.log`.
- Multi-profile canonical bridge smoke: **PASS** for all nine profiles (`core`, `production`, `review`, `integrations`, `extensions`, `work`, `media`, `publish`, `graph`); exact bundle SHA-256 and byte counts were rechecked before execution and every invocation stayed within the canonical input budget. Current output is retained in `evidence/r9/bundle-smoke.json`. This direct-process workstation smoke is not supported-engine or Driver Host isolation acceptance; R9 still requires the GitHub `native` lane.
- Clean CLI drill: init → synthetic demo → portable snapshot → restore to a new state directory → doctor PASS.
- Clean-room operator rehearsal launches those commands in fresh temporary state with only a minimal inherited environment, verifies Native SDK pin integrity, rejects exported session-token/machine-path leakage, and proves the restored workspace rotates generation without reactivating old mutation receipts. Current supplemental output is retained in `evidence/r9/clean-room.json`; GitHub CI repeats this on Linux, Windows and macOS and uploads the exact report per SHA.
- Restore drill confirmed a new workspace generation, advanced request epoch and no activation of historical mutation receipts.
- Independent `unzip -t` validation of a generated private bundle: **PASS**; exact channel manifest, candidate manifest, artifact bytes and review notice were all readable.
- Git diff whitespace gate: PASS.
- Executable DeltaCLI reference source: real process execution and bounded receipt ingestion PASS, including build-drift rejection, secret-bearing flag rejection, exact adapter pinning and retirement detection; technical state intentionally remains UNKNOWN without Driver Host admission.
- Executable DeltaRender extension fixture: bounded owner-controlled renderer output is recorded through an exact preparation/result contract; output-type substitution and package-budget overflow are rejected, and retirement preserves history while blocking new starts.
- Mobile-import fixture: bounded Android/iOS bundle normalization is import-only, records content hashes/provenance, and explicitly reports `device_execution_observed=false` and `IMPORTED_UNVERIFIED` instead of fabricating native capture.
- R7 local consumer rehearsal: a separate Node process that imports only the public client invokes a pinned ProductVersion through loopback HTTP under a `consume`-only identity; owner workspace reads, owner-session login and cross-consumer invocation inspection are rejected. Template edits leave the frozen ProductVersion digest unchanged, deprecation is observable, retirement blocks new invocations, and earlier invocation history remains readable by its own consumer.
- Prepared HTTP v2 envelopes are bound to the authenticated principal before mutation. Another consumer cannot submit that envelope, and durable recovery returns a stored result only to the principal that originally committed it.

These checks are useful regression evidence only. They are not supported-engine, Driver Host, browser-product-capture or external-channel acceptance. The local `RS-PUB-01..08` regressions plus the separate-process rehearsal establish application-side contract and identity isolation only; the source acceptance scenario still requires a real Platform Publish ProductVersion/deployment, canonical cross-tenant identity/entitlements, metered job execution and output ACL enforcement.

## Supported-engine GitHub acceptance

The repository requires Node 24.21.x. The current branch must pass `Application checks` on Linux, Windows and macOS after its commit is pushed.

Historical R8A evidence for exact source SHA `45f05b959e74dc6861bcdc3b5645014d64ceb4ad`: Application checks run `37432440809` passed on Linux, Windows and macOS; Native/Rust run `37432464643` passed; bounded stress run `37432467712` passed. PR #27 was merged only after those lanes completed. Historical R8B evidence was also green before merge: application checks run `37435456892` passed on Linux, Windows and macOS, with heavy runs `37435493927` and `37435497258` succeeding for the exact R8B source SHA. None of those PASS results are inherited by R9.

The manual heavy workflow provides independent lanes:

- **native**: build the pinned canonical TypeScript SDK, generate/hash all nine bounded bridge profiles, compile/test the real Rust NativeDriver including the compile-time Project Graph contract lock, and run a bridge smoke against each profile.
- **browser**: install Chromium on a disposable GitHub runner and exercise the real Launchwright UI.
- **stress**: create a bounded high-volume workspace, page observations, export a portable snapshot, restore it and verify row continuity.

Exact run IDs and SHA are recorded here only after completion.

## Behavior covered by the current local suite

Durable identity/revisions; exact archived entity history with get/list/diff; explicit schema-v1 to v2 migration that stores current state only and labels earlier history NOT_RECONSTRUCTED; snapshot-v2 history preservation plus safe v1 restore; stale CAS; request-digest idempotency and conflict; lost-reply recovery; cursor snapshot binding; source authorization; build/target separation; claims and ReleaseContracts; safe text/VTT output; immutable artifacts/candidates; candidate-v2 pins for target context, ReleaseContract, localization/glossary, channel profile and declared rights; review-race isolation and distinct-reviewer quorum; explicit partial-package policy; LTS pinning; relation provenance; owner-admitted Project Graph projection validation, visible-resource impact privacy, canonical knowledge/UNKNOWN preservation, bounded cycle-report custody, exact observed-edge backing, cache identity invalidation, exact-revision impact proposal/coalescing and rebuild/finalization receipts; immutable document change proposals with exact-base stale protection and explicit human-content acknowledgement; Platform-intent custody; application-side usage reservations, duplicate-event suppression, measured/estimated/BYO separation, measured correction chains, cost/runtime overrun visibility, Platform/native/artifact correlation and test-only billing callbacks without billing authority; Native SDK bridge; HTTP/client security; capture-contract v2 provenance with Platform/native correlation, readiness, unique-anchor cardinality, build-drift rejection, demo labeling, derivative lineage, scoped isolation, owned-resource cleanup, ordered segments and no-fake-UI eligibility; verifier authority and waivers; channel package/receipt state; deterministic authenticated private ZIP bundles with exact manifests/artifact bytes; versioned media plans with rational timing, source/claim revision pins, sanitized interactive-source constraints, three independent output classes, per-variant reuse detection, Composition handoff receipts and editorial decisions bound to exact output hashes; ReleaseTemplate/ProductVersion/deployment lifecycle with bounded consumer invocation, idempotent attempt keys, per-consumer inspection isolation, exact Platform-work bindings and authority-free export/import rebind; portable snapshot/restore.

## Explicitly not established

- canonical Driver Host isolation/acceptance of Launchwright; the executable DeltaCLI fixture proves a real non-DOM process path and receipt ingestion only, not Host isolation;
- live production Platform execution, budgets or billing;
- live Project Graph traversal/query execution, owner/Host admission and canonical effects evaluation; R9 validates and stores an admitted projection but does not replace those authorities;
- real browser/mobile/Godot product capture;
- Composition video/audio rendering and final-media verification;
- remote tenant/team authentication and canonical shared approvals;
- external public/cross-account Platform Publish execution, consumer job/output ACL acceptance, metering and destination activation;
- ChatGPT Plugin host acceptance;
- commercial-production deployment.

A stored receipt, hash, editorial decision, successful local render or local verifier report must not be described as one of those outcomes.
