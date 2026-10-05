# Acceptance ledger

This ledger separates implemented behavior from execution evidence. It does not inherit PASS from an upstream SHA, and it does not treat a proposed schema or imported producer assertion as canonical runtime evidence.

## Current local evidence

On the workstation with Node **22.22.0**, the complete light suite passes **90/90** with zero failures. This engine is outside the Native SDK's declared Node 24.21 range, so the result is supplemental rather than supported-engine acceptance.

The current light suite covers, among other boundaries:

- SQLite identity/revision persistence, transaction CAS, idempotency and recovery
- bounded snapshot observations and stale cursors
- source authorization, target context separation and safe text/VTT rendering
- immutable artifact bytes, exact candidate hashes and stale-input invalidation
- ReleaseContract readiness, Claim/CopyBlock dependency propagation and impact proposals
- tombstones and explicit relation provenance
- Platform pending-request custody/recovery simulations
- genuine canonical Node bridge execution in a separate process
- ChannelProfile pins and independent technical/editorial/permissions reviews
- waivers that cannot manufacture technical PASS
- deterministic candidate ZIP bundles and authenticated exact-byte download
- portable workspace export, integrity rejection, dry-run and restore with generation rotation
- anti-replay portability: receipts and pending dispatch are not restored
- artifact-integrity failure blocks private export instead of remaining draft-safe
- ChannelProfile format/byte limits and stale-profile dispatch rejection
- durable ChannelAttempt custody before send, per-participant PREPARED/SENT/PROCESSING/OBSERVED_PUBLISHED/FAILED/UNKNOWN states and duplicate logical-request blocking
- lost-acknowledgement UNKNOWN/reconcile flow with no automatic resend and an explicit, reconciled retry chain
- publication claims requiring independent destination observation/fingerprint
- bounded withdrawal plans that never claim all downstream copies were removed
- durable per-entity revision history with explicit legacy migration that never invents old revisions
- structured documents with human/managed block ownership, exact-base proposals, external revision pins and immutable renders
- localization records with source/target/glossary/font pins, RTL-safe HTML and required human semantic review for lexical risk
- declarative extension contracts with semantic-version negotiation, generic metadata views and retirement without descriptor code execution
- workspace schema negotiation and read-only doctor endpoints that fail explicitly on incompatible majors

A real CLI portability smoke exported **27 entities and 4 blobs**, previewed the restore, committed it into a new workspace and confirmed a new workspace generation. That run restored zero receipts and zero pending dispatch records.

`node scripts/verify.mjs` currently verifies the vendored canonical Native SDK pin at Semwright commit `4d291de26724810017ce7b6d185326514cb79fa6`.

## CI evidence

Heavy run `37269134839` passed both the real Rust NativeDriver/bundle lane and Chromium application-UI lane on commit `74e11e604e9b07a6b9f9fe2c2c3944345f40f4d4` using Node 24.21.0. That PASS validates the deterministic compressed bundle fix at that exact SHA only; the later ChannelAttempt wave must be rerun on its own commit before receiving the same status. Do not transplant a green result from another SHA.

## Not established by local tests

The following remain unproved until their canonical integration/acceptance evidence exists:

- production Driver Host admission and isolation
- complete Project Graph/effects authority
- real web/mobile/Godot capture
- Composition/video/audio rendering
- production Platform connectivity and authoritative cost ledger
- public/cross-account publication and remote channel receipts
- remote multi-user identity/ACL approval
- external store/social/email acceptance or withdrawal
- ChatGPT Plugin host acceptance
- commercial-production deployment

Implementation of an adapter or a passing simulation must not be represented as those end-to-end outcomes.
