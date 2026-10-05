# Acceptance ledger

This ledger separates implemented behavior from execution evidence. A PASS belongs to an exact SHA, environment and lane; it is never inherited from another commit.

## Supplemental workstation checks

Current pass, before commit:

- Node: 22.22.0 — **outside** the Native SDK supported engine.
- `npm test`: **76 passed, 0 failed, 0 skipped**.
- `node scripts/verify.mjs`: source-lock integrity and syntax PASS; 28 JavaScript modules checked.
- Clean CLI drill: init → synthetic demo → portable snapshot → restore to a new state directory → doctor PASS.
- Restore drill confirmed a new workspace generation, advanced request epoch and no activation of historical mutation receipts.
- Git diff whitespace gate: PASS.

These checks are useful regression evidence only. They are not supported-engine, Driver Host, browser-product-capture or external-channel acceptance.

## Supported-engine GitHub acceptance

The repository requires Node 24.21.x. The current branch must pass `Application checks` on Linux, Windows and macOS after its commit is pushed.

The manual heavy workflow provides independent lanes:

- **native**: build pinned canonical TypeScript SDK, generate exact native bundle, compile/test real Rust NativeDriver, run bundle smoke.
- **browser**: install Chromium on a disposable GitHub runner and exercise the real Launchwright UI.
- **stress**: create a bounded high-volume workspace, page observations, export a portable snapshot, restore it and verify row continuity.

Exact run IDs and SHA are recorded here only after completion.

## Behavior covered by the current local suite

Durable identity/revisions; stale CAS; request-digest idempotency and conflict; lost-reply recovery; cursor snapshot binding; source authorization; build/target separation; claims and ReleaseContracts; safe text/VTT output; immutable artifacts/candidates; LTS pinning; relation provenance; impact proposals; Platform-intent custody; Native SDK bridge; HTTP/client security; capture receipt provenance; verifier authority and waivers; channel package/receipt state; portable snapshot/restore.

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
