# Acceptance ledger

This ledger separates implemented behavior from execution evidence. A PASS belongs to an exact SHA, environment and lane; it is never inherited from another commit.

## Supplemental workstation checks

Current pass, before commit:

- Node: 22.22.0 — **outside** the Native SDK supported engine.
- `npm test`: **129 passed, 0 failed, 0 skipped**. Exact TAP output is retained in `evidence/workstation-publish-pass.tap`.
- `node scripts/verify.mjs`: source-lock integrity and syntax PASS; **65 JavaScript modules and 64 Native driver operations** checked. Output is retained in `evidence/workstation-publish-verify.json`.
- Native profile build: **64/64 public operations assigned exactly once** across seven compacted canonical bridge bundles. Exact local sizes are core **45,304**, production **45,504**, review **49,056**, integrations **38,684**, work **31,627**, media **39,558**, publish **48,058** bytes. The review profile has only 96 bytes of local headroom; the 49,152-byte NodeBridge limit was not raised or bypassed.
- Multi-profile canonical bridge smoke: **PASS** for `core`, `production`, `review`, `integrations`, `work`, `media` and `publish`; exact bundle SHA-256 values were rechecked before execution and all seven invocation frames stayed within the canonical combined-input budget. Output is retained in `evidence/workstation-publish-bundle-smoke.json`. This is not Driver Host isolation acceptance.
- Clean CLI drill: init → synthetic demo → portable snapshot → restore to a new state directory → doctor PASS.
- Restore drill confirmed a new workspace generation, advanced request epoch and no activation of historical mutation receipts.
- Independent `unzip -t` validation of a generated private bundle: **PASS**; exact channel manifest, candidate manifest, artifact bytes and review notice were all readable.
- Git diff whitespace gate: PASS.

These checks are useful regression evidence only. They are not supported-engine, Driver Host, browser-product-capture or external-channel acceptance. The local `RS-PUB-01..08` regressions establish application-side contract behavior only; the source acceptance scenario still requires a real Platform Publish ProductVersion/deployment and a distinct consumer identity/job/output ACL path.

## Supported-engine GitHub acceptance

The repository requires Node 24.21.x. The current branch must pass `Application checks` on Linux, Windows and macOS after its commit is pushed.

The manual heavy workflow provides independent lanes:

- **native**: build the pinned canonical TypeScript SDK, generate/hash all seven bounded bridge profiles, compile/test the real Rust NativeDriver, and run a bridge smoke against each profile.
- **browser**: install Chromium on a disposable GitHub runner and exercise the real Launchwright UI.
- **stress**: create a bounded high-volume workspace, page observations, export a portable snapshot, restore it and verify row continuity.

Exact run IDs and SHA are recorded here only after completion.

## Behavior covered by the current local suite

Durable identity/revisions; exact archived entity history with get/list/diff; explicit schema-v1 to v2 migration that stores current state only and labels earlier history NOT_RECONSTRUCTED; snapshot-v2 history preservation plus safe v1 restore; stale CAS; request-digest idempotency and conflict; lost-reply recovery; cursor snapshot binding; source authorization; build/target separation; claims and ReleaseContracts; safe text/VTT output; immutable artifacts/candidates; candidate-v2 pins for target context, ReleaseContract, localization/glossary, channel profile and declared rights; review-race isolation and distinct-reviewer quorum; explicit partial-package policy; LTS pinning; relation provenance; impact proposals; immutable document change proposals with exact-base stale protection and explicit human-content acknowledgement; Platform-intent custody; Native SDK bridge; HTTP/client security; capture-contract v2 provenance with Platform/native correlation, readiness, unique-anchor cardinality, build-drift rejection, demo labeling, derivative lineage, scoped isolation, owned-resource cleanup, ordered segments and no-fake-UI eligibility; verifier authority and waivers; channel package/receipt state; deterministic authenticated private ZIP bundles with exact manifests/artifact bytes; versioned media plans with rational timing, source/claim revision pins, sanitized interactive-source constraints, three independent output classes, per-variant reuse detection, Composition handoff receipts and editorial decisions bound to exact output hashes; ReleaseTemplate/ProductVersion/deployment lifecycle with bounded consumer invocation, idempotent attempt keys, per-consumer inspection isolation, exact Platform-work bindings and authority-free export/import rebind; portable snapshot/restore.

## Explicitly not established

- canonical Driver Host isolation/acceptance of Launchwright;
- live production Platform execution, budgets or billing;
- canonical Project Graph/effects coverage;
- real browser/mobile/Godot product capture;
- Composition video/audio rendering and final-media verification;
- remote tenant/team authentication and canonical shared approvals;
- external public/cross-account Platform Publish execution, consumer job/output ACL acceptance, metering and destination activation;
- ChatGPT Plugin host acceptance;
- commercial-production deployment.

A stored receipt, hash, editorial decision, successful local render or local verifier report must not be described as one of those outcomes.
