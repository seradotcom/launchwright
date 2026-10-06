# Requirements traceability

The private product specification used to start Launchwright contains 196 requirement records across domain model, SDK, sources, capture, process, claims, graph, verification, media, docs, localization, channels, review, publishing, UX, API, security, data, operations, extensions, QA and go-to-market concerns.

The private specification text is intentionally not redistributed in this AGPL repository. This file records implementation status without copying that source. `requirements-index.json` preserves all 196 requirement IDs, acceptance-test IDs, scenario IDs, scope and priority so implementation evidence can be attached without republishing the private prose.

## Current implemented foundations

- Durable resource identity, optimistic concurrency, tombstones and append-only audit events, plus exact entity revision history in schema v2 with bounded history reads/diffs and explicit legacy migration that never invents missing revisions.
- Native SDK dispatcher/bridge, exact digests, cancellation, recovery and bounded observation.
- Build/source/target/scenario/anchor contracts with explicit authorization and provenance.
- Claims, CopyBlocks, availability and ReleaseContract denominators without fabricated coverage.
- Immutable text artifacts, exact candidate manifests and freshness invalidation.
- Explicit relation provenance and impact proposals with no execution authority.
- RS-GRF application-side canonical Project Graph custody: exact `project.*` preparation, bounded traversal/visibility, exact resource-revision bindings, immutable response digests, UNKNOWN-by-default admission, stale-binding invalidation, provenance-gated observed relations, authority-free impact coalescing and principal-scoped reuse keys. Live Host/Broker admission remains a separate acceptance gate.
- Canonical Effects immutable-artifact readback custody: exact `semwright-native-effects-result/1` bytes, result/spec/source/runtime digests, exact JSON/CSV artifact and optional scenario revision pins, owner-gated admission, stale-binding invalidation and a real upstream CLI acceptance lane. This does not claim native mutation/noninterference or scenario-effect coverage.
- Application-local document change proposals for CopyBlocks and deliverables: proposal creation never mutates content, application requires an exact base revision, stale proposals fail closed, and human-owned/whole-document content requires explicit acknowledgement.
- Capture contract v2 covering receipt correlation, readiness, anchor uniqueness, build drift, demo-data labeling, derivative lineage, isolation, bounded cleanup, ordered segments and no-fake-UI eligibility; technical state remains UNKNOWN.
- RS-VER protected-oracle custody: admin-only verifier descriptors, candidate-pinned exact verifier revision/digest/policy, canonical complete/negative-control requirements for release-gating dimensions, exact candidate/artifact/target report bindings, visible coverage/omissions, drift-to-UNKNOWN behavior, explicit ERROR/repair actions and non-state-changing waivers. Canonical verifier execution/runtime admission remains external.
- Versioned channel packages plus authenticated deterministic private bundles containing the exact channel manifest, candidate manifest and pinned artifact bytes.
- Versioned channel profiles, exact package generation and external receipt/recovery state.
- Publish-side application contracts for RS-PUB-01..08: editable ReleaseTemplate drafts, immutable ProductVersion pins, bounded consumer parameters/budgets, exact deployment lifecycle, per-consumer invocation isolation/idempotency and export/import without transferring authority. Actual external Platform acceptance remains separate.
- Portable snapshot/restore v2 with exact stored revision history, migration provenance, epoch/generation rotation, uncertain-intent suspension and backward-compatible v1 restore without historical reconstruction.
- Loopback HTTP/UI security, bounded payloads and session-cookie authentication.
- API/UX foundations for RS-API/RS-UX: authenticated capability discovery before UI inventory, snapshot-bound resource observation, fixed-watermark event pagination with source/revision/cause metadata, public-client event iteration, reloadable resource deep links that do not mutate state, and a separately packable clean-room client with explicit discovery/API negotiation that fails closed on unsupported contracts.
- RS-PRO-03 application-side mobile import: bounded manifest plus PNG/JPEG/MP4 assets, exact hashes, container dimensions, build/device/OS/locale/origin/rights provenance, content-addressed immutable artifacts and ChannelProfile-compatible candidate packaging. Admission remains `imported-unverified`; real device/runner execution is not inferred.
- RS-PRO-02/RS-PRO-08 Godot source profile: exact Semwright/Godot driver and engine pins, logical project locators, build/approval checks and canonical Native SDK preflight. Generic CLI remains fail-closed because the reviewed Semwright snapshot has no approved arbitrary-shell provider. The real-engine GitHub lane is separate evidence and does not synthesize Platform, capture-admission or Driver Host receipts.
- Owned DeltaDesk A/B browser laboratory: immutable build identities, en-US/es-MX demo surfaces, bounded roles/plans, explicit reset, semantic availability drift and checkout-copy/layout drift. Browser preflight pins the exact reviewed Semwright Chromium provider plus executable digest, and the dedicated heavy lane executes the real semantic adapter against the fixture while preserving Platform/capture/Host authority as false.

## Integration-dependent / not accepted

Platform-admitted product capture across target applications (the owned DeltaDesk Semwright Chromium interoperability lane is narrower evidence only); live Host/Broker admission and end-to-end Project Graph acceptance; native application effect/noninterference and scenario-effect acceptance beyond immutable-artifact readback; Composition video rendering; real Platform job execution; canonical verifier runtime admission; remote teams; real cross-account Platform Publish execution/output ACLs/external activation; real Android/iOS runner/device acceptance (including Fastlane-style execution), admitted Launchwright Godot product capture/Platform receipt/Driver Host isolation; ChatGPT Plugin host acceptance; production deployment.

Requirement completion is therefore not represented as a single vanity percentage. Evidence is tracked by exact behavior, SHA and acceptance lane in `ACCEPTANCE.md`.
