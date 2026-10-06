# Acceptance ledger

This ledger separates implemented behavior from execution evidence. A PASS belongs to an exact SHA, environment and lane; it is never inherited from another commit.

## Supplemental workstation checks

Supplemental workstation pass for this branch:

- Node: 22.22.0 — **outside** the Native SDK supported engine.
- `npm test`: **143 passed, 0 failed, 0 skipped** on the current operations/clean-room branch. Exact TAP output is retained in `evidence/r8a/local-test.tap`; this local run is supplemental because Node 22.22.0 is outside the supported engine.
- `node scripts/verify.mjs`: source-lock integrity and syntax PASS; **78 JavaScript modules and 71 Native driver operations** checked. Current output is retained in `evidence/r8a/verify.json`.
- Native profile build: **71/71 public operations assigned exactly once** across eight compacted canonical bridge bundles. Exact local sizes are core **45,595**, production **45,734**, review **49,129**, integrations **31,825**, extensions **42,300**, work **31,857**, media **39,788**, publish **48,288** bytes. The review profile has 23 bytes of local headroom; the 49,152-byte NodeBridge limit was not raised or bypassed.
- Multi-profile canonical bridge smoke: **PASS** for `core`, `production`, `review`, `integrations`, `extensions`, `work`, `media` and `publish`; exact bundle SHA-256 values were rechecked before execution and all eight invocation frames stayed within the canonical combined-input budget. Output is retained in `evidence/workstation-publish-consumer-bundle-smoke.json`. This is not Driver Host isolation acceptance.
- Clean CLI drill: init → synthetic demo → portable snapshot → restore to a new state directory → doctor PASS.
- Clean-room operator rehearsal launches those commands in fresh temporary state with only a minimal inherited environment, verifies Native SDK pin integrity, rejects exported session-token/machine-path leakage, and proves the restored workspace rotates generation without reactivating old mutation receipts. GitHub CI repeats this on Linux, Windows and macOS and uploads the exact report per SHA.
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

The manual heavy workflow provides independent lanes:

- **native**: build the pinned canonical TypeScript SDK, generate/hash all eight bounded bridge profiles, compile/test the real Rust NativeDriver, and run a bridge smoke against each profile.
- **browser**: install Chromium on a disposable GitHub runner and exercise the real Launchwright UI.
- **stress**: create a bounded high-volume workspace, page observations, export a portable snapshot, restore it and verify row continuity.

Exact run IDs and SHA are recorded here only after completion.

## Behavior covered by the current local suite

Durable identity/revisions; exact archived entity history with get/list/diff; explicit schema-v1 to v2 migration that stores current state only and labels earlier history NOT_RECONSTRUCTED; snapshot-v2 history preservation plus safe v1 restore; stale CAS; request-digest idempotency and conflict; lost-reply recovery; cursor snapshot binding; source authorization; build/target separation; claims and ReleaseContracts; safe text/VTT output; immutable artifacts/candidates; candidate-v2 pins for target context, ReleaseContract, localization/glossary, channel profile and declared rights; review-race isolation and distinct-reviewer quorum; explicit partial-package policy; LTS pinning; relation provenance; impact proposals; immutable document change proposals with exact-base stale protection and explicit human-content acknowledgement; Platform-intent custody; Native SDK bridge; HTTP/client security; capture-contract v2 provenance with Platform/native correlation, readiness, unique-anchor cardinality, build-drift rejection, demo labeling, derivative lineage, scoped isolation, owned-resource cleanup, ordered segments and no-fake-UI eligibility; verifier authority and waivers; channel package/receipt state; deterministic authenticated private ZIP bundles with exact manifests/artifact bytes; versioned media plans with rational timing, source/claim revision pins, sanitized interactive-source constraints, three independent output classes, per-variant reuse detection, Composition handoff receipts and editorial decisions bound to exact output hashes; ReleaseTemplate/ProductVersion/deployment lifecycle with bounded consumer invocation, idempotent attempt keys, per-consumer inspection isolation, exact Platform-work bindings and authority-free export/import rebind; portable snapshot/restore.

## Explicitly not established

- canonical Driver Host isolation/acceptance of Launchwright; the executable DeltaCLI fixture proves a real non-DOM process path and receipt ingestion only, not Host isolation;
- live production Platform execution, budgets or billing;
- canonical Project Graph/effects coverage;
- real browser/mobile/Godot product capture;
- Composition video/audio rendering and final-media verification;
- remote tenant/team authentication and canonical shared approvals;
- external public/cross-account Platform Publish execution, consumer job/output ACL acceptance, metering and destination activation;
- ChatGPT Plugin host acceptance;
- commercial-production deployment.

A stored receipt, hash, editorial decision, successful local render or local verifier report must not be described as one of those outcomes.
