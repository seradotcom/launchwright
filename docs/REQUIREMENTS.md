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
- Application-local document change proposals for CopyBlocks and deliverables: proposal creation never mutates content, application requires an exact base revision, stale proposals fail closed, and human-owned/whole-document content requires explicit acknowledgement.
- Capture contract v2 covering receipt correlation, readiness, anchor uniqueness, build drift, demo-data labeling, derivative lineage, isolation, bounded cleanup, ordered segments and no-fake-UI eligibility; technical state remains UNKNOWN.
- Immutable verifier records, coverage/omissions/findings and non-state-changing waivers.
- Versioned channel packages plus authenticated deterministic private bundles containing the exact channel manifest, candidate manifest and pinned artifact bytes.
- Versioned channel profiles, exact package generation and external receipt/recovery state.
- Publish-side application contracts for RS-PUB-01..08: editable ReleaseTemplate drafts, immutable ProductVersion pins, bounded consumer parameters/budgets, exact deployment lifecycle, per-consumer invocation isolation/idempotency and export/import without transferring authority. Actual external Platform acceptance remains separate.
- Portable snapshot/restore v2 with exact stored revision history, migration provenance, epoch/generation rotation, uncertain-intent suspension and backward-compatible v1 restore without historical reconstruction.
- Operations-side foundations for RS-OPS-06/07/08/10: measurements keep query/mutation/snapshot/restore distinct from unavailable Platform admission/queue/render phases; `doctor` is read-only and reports concrete remediation; a clean-room reproduction exercises documented init/demo/snapshot/restore commands without inheriting author secrets or hidden paths. Platform ledger/billing acceptance remains external.
- Loopback HTTP/UI security, bounded payloads and session-cookie authentication.
- Versioned extension descriptors now support exact prepared-use pins, safe generic metadata views, resolved-rights enforcement, retirement-aware start blocking, schema-major rejection, bounded generic result receipts and drift inspection. Owned executable DeltaCLI/DeltaRender fixtures plus a bounded mobile-import fixture exercise non-DOM source, renderer and import-only paths without claiming canonical Driver Host or device-capture authority.

## Integration-dependent / not accepted

Real product capture across target applications; canonical Project Graph/effects; Composition video rendering; real Platform job execution; canonical verifier runtime admission; remote teams; real cross-account Platform Publish execution/output ACLs/external activation; mobile/Godot target acceptance; ChatGPT Plugin host acceptance; production deployment.

Requirement completion is therefore not represented as a single vanity percentage. Evidence is tracked by exact behavior, SHA and acceptance lane in `ACCEPTANCE.md`.
