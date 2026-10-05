# Acceptance ledger

This ledger separates implemented behavior from execution evidence. It does not inherit PASS from an upstream SHA, and it does not treat a proposed schema or imported producer assertion as canonical runtime evidence.

## Current local evidence

On the workstation with Node **22.22.0**, the complete light suite passes **75/75** with zero failures. This engine is outside the Native SDK's declared Node 24.21 range, so the result is supplemental rather than supported-engine acceptance.

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

A real CLI portability smoke exported **27 entities and 4 blobs**, previewed the restore, committed it into a new workspace and confirmed a new workspace generation. That run restored zero receipts and zero pending dispatch records.

`node scripts/verify.mjs` currently verifies the vendored canonical Native SDK pin at Semwright commit `4d291de26724810017ce7b6d185326514cb79fa6`.

## CI evidence

The supported-engine application workflow and the native/browser heavy workflow are configured but must be tied to the exact Launchwright commit and GitHub run IDs. Do not transplant a green result from another SHA.

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
