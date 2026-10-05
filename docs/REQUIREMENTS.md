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
- Capture receipt ingestion that stays technical UNKNOWN.
- Immutable verifier records, coverage/omissions/findings and non-state-changing waivers.
- Versioned channel packages plus authenticated deterministic private bundles containing the exact channel manifest, candidate manifest and pinned artifact bytes.
- Versioned channel profiles, exact package generation and external receipt/recovery state.
- Portable snapshot/restore v2 with exact stored revision history, migration provenance, epoch/generation rotation, uncertain-intent suspension and backward-compatible v1 restore without historical reconstruction.
- Loopback HTTP/UI security, bounded payloads and session-cookie authentication.

## Integration-dependent / not accepted

Real product capture across target applications; canonical Project Graph/effects; Composition video rendering; real Platform job execution; canonical verifier runtime admission; remote teams; public/cross-account Publish; mobile/Godot target acceptance; ChatGPT Plugin host acceptance; production deployment.

Requirement completion is therefore not represented as a single vanity percentage. Evidence is tracked by exact behavior, SHA and acceptance lane in `ACCEPTANCE.md`.
