# Requirements traceability

The private product specification used to start Launchwright contains 196 requirement records across domain model, SDK, sources, capture, process, claims, graph, verification, media, docs, localization, channels, review, publishing, UX, API, security, data, operations, extensions, QA and go-to-market concerns.

The private specification text is intentionally not redistributed in this AGPL repository. This file records implementation status without copying that source.

## Current implemented foundations

- Durable resource identity, revisions, optimistic concurrency, tombstones and append-only audit events.
- Native SDK dispatcher/bridge, exact digests, cancellation, recovery and bounded observation.
- Build/source/target/scenario/anchor contracts with explicit authorization and provenance.
- Claims, CopyBlocks, availability and ReleaseContract denominators without fabricated coverage.
- Immutable text artifacts, exact candidate manifests and freshness invalidation.
- Explicit relation provenance and impact proposals with no execution authority.
- Capture receipt ingestion that stays technical UNKNOWN.
- Immutable verifier records, coverage/omissions/findings and non-state-changing waivers.
- Versioned channel profiles, exact package generation and external receipt/recovery state.
- Portable snapshot/restore with epoch/generation rotation and uncertain-intent suspension.
- Loopback HTTP/UI security, bounded payloads and session-cookie authentication.

## Integration-dependent / not accepted

Real product capture across target applications; canonical Project Graph/effects; Composition video rendering; real Platform job execution; canonical verifier runtime admission; remote teams; public/cross-account Publish; mobile/Godot target acceptance; ChatGPT Plugin host acceptance; production deployment.

Requirement completion is therefore not represented as a single vanity percentage. Evidence is tracked by exact behavior, SHA and acceptance lane in `ACCEPTANCE.md`.
