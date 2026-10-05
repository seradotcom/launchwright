# Acceptance ledger

This ledger separates implemented behavior from execution evidence. A PASS belongs to an exact SHA, environment and lane; it is never inherited from another commit.

## Supplemental workstation checks

Current pass, before commit:

- Node: 22.22.0 — **outside** the Native SDK supported engine.
- `npm test`: **107 passed, 0 failed, 0 skipped**.
- `node scripts/verify.mjs`: source-lock integrity and syntax PASS; 54 JavaScript modules checked.
- Native profile build: **49/49 public operations assigned exactly once** across five compacted canonical bridge bundles; core is 44,598 bytes after adding the three history reads. The largest local bundle remains review at 49,131 bytes, 21 bytes below the 49,152-byte NodeBridge limit; no further review-profile growth is acceptable without repartitioning/minification work.
- Multi-profile canonical bridge smoke: **PASS** for `core`, `production`, `review`, `integrations` and `work`; exact bundle SHA-256 values were rechecked before execution. This is not Driver Host isolation acceptance.
- Clean CLI drill: init → synthetic demo → portable snapshot → restore to a new state directory → doctor PASS.
- Restore drill confirmed a new workspace generation, advanced request epoch and no activation of historical mutation receipts.
- Independent `unzip -t` validation of a generated private bundle: **PASS**; exact channel manifest, candidate manifest, artifact bytes and review notice were all readable.
- Git diff whitespace gate: PASS.

These checks are useful regression evidence only. They are not supported-engine, Driver Host, browser-product-capture or external-channel acceptance.

## Supported-engine GitHub acceptance

The repository requires Node 24.21.x. The current branch must pass `Application checks` on Linux, Windows and macOS after its commit is pushed.

The manual heavy workflow provides independent lanes:

- **native**: build the pinned canonical TypeScript SDK, generate/hash all five bounded bridge profiles, compile/test the real Rust NativeDriver, and run a bridge smoke against each profile.
- **browser**: install Chromium on a disposable GitHub runner and exercise the real Launchwright UI.
- **stress**: create a bounded high-volume workspace, page observations, export a portable snapshot, restore it and verify row continuity.

Exact run IDs and SHA are recorded here only after completion.

## Behavior covered by the current local suite

Durable identity/revisions; exact archived entity history with get/list/diff; explicit schema-v1 to v2 migration that stores current state only and labels earlier history NOT_RECONSTRUCTED; snapshot-v2 history preservation plus safe v1 restore; stale CAS; request-digest idempotency and conflict; lost-reply recovery; cursor snapshot binding; source authorization; build/target separation; claims and ReleaseContracts; safe text/VTT output; immutable artifacts/candidates; candidate-v2 pins for target context, ReleaseContract, localization/glossary, channel profile and declared rights; review-race isolation and distinct-reviewer quorum; explicit partial-package policy; LTS pinning; relation provenance; impact proposals; immutable document change proposals with exact-base stale protection and explicit human-content acknowledgement; Platform-intent custody; Native SDK bridge; HTTP/client security; capture receipt provenance; verifier authority and waivers; channel package/receipt state; deterministic authenticated private ZIP bundles with exact manifests/artifact bytes; portable snapshot/restore.

## Explicitly not established

- canonical Driver Host isolation/acceptance of Launchwright;
- live production Platform execution, budgets or billing;
- canonical Project Graph/effects coverage;
- real browser/mobile/Godot product capture;
- Composition video/audio rendering and final-media verification;
- remote tenant/team authentication and canonical shared approvals;
- external public/cross-account Publish and destination activation;
- ChatGPT Plugin host acceptance;
- commercial-production deployment.

A stored receipt, hash, editorial decision, successful local render or local verifier report must not be described as one of those outcomes.
