# Acceptance ledger

This ledger separates implemented behavior from execution evidence. A PASS belongs to an exact SHA, environment and lane; it is never inherited from another commit.

## Supplemental workstation checks

Current pass, before commit:

- Node: 22.22.0 — **outside** the Native SDK supported engine.
- `npm test`: **161 passed, 0 failed, 0 skipped**. Exact TAP output is retained in `evidence/workstation-graph-pass.tap`. Seven focused RS-GRF regressions cover canonical argument preparation, bounded visibility/traversal, explicit Graph mutation consent, UNKNOWN-by-default admission, stale bindings, observed-relation provenance and cause-preserving impact coalescing.
- `node scripts/verify.mjs`: source-lock integrity, application/public-client alignment, public-client isolation and syntax PASS; **85 JavaScript modules and 68 Native driver operations** checked. Output is retained in `evidence/workstation-graph-verify.json`.
- Native profile build: **68/68 public operations assigned exactly once** across nine compacted bridge bundles. Sizes: core **44,617**, sources **25,312**, graph **26,175**, production **47,573**, review **47,553**, integrations **47,336**, work **35,421**, media **38,048**, publish **46,944** bytes. The 49,152-byte NodeBridge limit was not raised; the narrowest headroom is 1,579 bytes in `production`.
- Multi-profile canonical bridge smoke: **PASS** for `core`, `sources`, `graph`, `production`, `review`, `integrations`, `work`, `media` and `publish`; exact hashes were rechecked and all nine invocation frames stayed within the canonical input budget. `evidence/native/bundle-smoke.json` records the result. This is not Driver Host isolation acceptance.
- Public-client clean-room: **PASS**. `client/` was packed as `@launchwright/client`, installed into a fresh temporary project containing no Launchwright application modules, then used to negotiate discovery and create/read a Product through the public HTTP surface. Unsupported discovery/API versions and absent required operations fail with `Unsupported`. This is package-boundary evidence only; no registry publication or external host acceptance is claimed.
- Mobile import/application profile: **PASS** on synthetic owned fixtures. The local ingestor rejects traversal and digest/build mismatches, validates bounded PNG/JPEG/MP4 metadata, stages exact content-addressed bytes, records `imported-unverified` evidence plus immutable artifacts, and packages those artifacts through a pinned ChannelProfile while technical/native-capture state remains `UNKNOWN`/false. Rights `unknown` remains `PENDING_RIGHTS`. This does not establish a real Android/iOS runner or device capture.
- Godot source-profile contract: **PASS** on application fixtures. Exact Semwright SHA, driver version, Godot 4.7.2 binary digest, logical `godot://project/<id>` locator, source approval and build match are required before `ready_for_native_execution` can become true. The generic CLI profile remains fail-closed even if a caller declares local execution authority. This local PASS does **not** establish real Godot execution; the separate heavy `godot` lane must do that on a disposable runner.
- DeltaDesk/browser contract: **PASS** on owned local fixtures. Builds A/B, en-US/es-MX, role/plan behavior, reset, semantic availability drift and checkout CTA/order drift are covered. Browser preflight requires approved web source/build match, explicit execution authority, exact Semwright `4d291de…`, provider `chromium` and a concrete executable SHA-256. This local PASS does **not** establish real Chromium execution; the separate heavy `deltadesk` lane must do that on a disposable runner.
- Clean CLI drill: init → synthetic demo → portable snapshot → restore to a new state directory → doctor PASS.
- Restore drill confirmed a new workspace generation, advanced request epoch and no activation of historical mutation receipts.
- Independent `unzip -t` validation of a generated private bundle: **PASS**; exact channel manifest, candidate manifest, artifact bytes and review notice were all readable.
- Git diff whitespace gate: PASS.

These checks are useful regression evidence only. They are not supported-engine, Driver Host, real browser/device capture or external-channel acceptance. The local `RS-PUB-01..08` regressions establish application-side contract behavior only; the source acceptance scenario still requires a real Platform Publish ProductVersion/deployment and a distinct consumer identity/job/output ACL path. API/UX regressions establish discovery, watermark-stable event reads, deep-link routing and a package-isolated HTTP consumer in the application contract; browser/Plugin host acceptance and the specification's truly separate external repository consumer remain distinct gates.

## Supported-engine GitHub acceptance

The repository requires Node 24.21.x. The current branch must pass `Application checks` on Linux, Windows and macOS after its commit is pushed.

The manual heavy workflow provides independent lanes:

- **native**: build the pinned canonical TypeScript SDK, generate/hash all nine bounded bridge profiles, compile/test the real Rust NativeDriver including the Native SDK `graph` feature, and run a bridge smoke against each profile.
- **browser**: install Chromium on a disposable GitHub runner and exercise the real Launchwright UI.
- **godot**: check out exact Semwright `4d291de26724810017ce7b6d185326514cb79fa6`, verify the official Godot 4.7.2 Linux binary digest, build the production Semwright Godot driver, run its real-editor E2E harness and bind the resulting trace to Launchwright preflight while keeping Platform/capture/Host claims false.
- **deltadesk**: start owned DeltaDesk A/B, bind `/opt/google/chrome/chrome` on the disposable Ubuntu runner exactly like Semwright's own Chromium CI, execute the real Semwright `Chromium` semantic adapter against those surfaces, retain exact screenshots/receipt hashes and bind the observed runtime to Launchwright while keeping Platform/capture/Host admission false.
- **stress**: create a bounded high-volume workspace, page observations, export a portable snapshot, restore it and verify row continuity.

Exact run IDs and SHA are recorded here only after completion.

## Behavior covered by the current local suite

Durable identity/revisions; exact archived entity history with get/list/diff; explicit schema-v1 to v2 migration that stores current state only and labels earlier history NOT_RECONSTRUCTED; snapshot-v2 history preservation plus safe v1 restore; stale CAS; request-digest idempotency and conflict; lost-reply recovery; cursor snapshot binding; source authorization; build/target separation; claims and ReleaseContracts; safe text/VTT output; immutable artifacts/candidates; candidate-v2 pins for target context, ReleaseContract, localization/glossary, channel profile and declared rights; review-race isolation and distinct-reviewer quorum; explicit partial-package policy; LTS pinning; relation provenance; canonical Project Graph preparation/response custody with exact local bindings, UNKNOWN-by-default admission, stale-binding invalidation and cause-preserving coalescing; impact proposals; immutable document change proposals with exact-base stale protection and explicit human-content acknowledgement; Platform-intent custody; Native SDK bridge; HTTP/client security; authenticated discovery before inventory; fixed-watermark event snapshots with durable event IDs, application source, workspace generation, committed revision and request cause; public-client event iteration; reloadable resource deep links without implicit mutation; capture-contract v2 provenance with Platform/native correlation, readiness, unique-anchor cardinality, build-drift rejection, demo labeling, derivative lineage, scoped isolation, owned-resource cleanup, ordered segments and no-fake-UI eligibility; verifier authority and waivers; channel package/receipt state; deterministic authenticated private ZIP bundles with exact manifests/artifact bytes; versioned media plans with rational timing, source/claim revision pins, sanitized interactive-source constraints, three independent output classes, per-variant reuse detection, Composition handoff receipts and editorial decisions bound to exact output hashes; bounded mobile package import with hash/container/dimension/build/provenance/rights validation, immutable imported artifacts and ChannelProfile draft packaging without native-capture promotion; owned DeltaDesk A/B source behavior plus exact Semwright Chromium runtime preflight without Platform/capture promotion; ReleaseTemplate/ProductVersion/deployment lifecycle with bounded consumer invocation, idempotent attempt keys, per-consumer inspection isolation, exact Platform-work bindings and authority-free export/import rebind; portable snapshot/restore.

## Explicitly not established

- canonical Driver Host isolation/acceptance of Launchwright;
- live production Platform execution, budgets or billing;
- live Host/Broker admission and supported-runner end-to-end Project Graph CURRENT/STALE evidence; canonical effects coverage;
- Platform-admitted/customer-product browser capture, real Android/iOS runner/device capture, or admitted real Godot product capture (the DeltaDesk/Godot interoperability lanes are narrower prerequisites, not capture admission);
- Composition video/audio rendering and final-media verification;
- remote tenant/team authentication and canonical shared approvals;
- external public/cross-account Platform Publish execution, consumer job/output ACL acceptance, metering and destination activation;
- ChatGPT Plugin host acceptance;
- commercial-production deployment.

A stored receipt, hash, editorial decision, successful local render or local verifier report must not be described as one of those outcomes.
