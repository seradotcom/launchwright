# Architecture

Launchwright is an application layer over Semwright contracts, not a replacement for Semwright Platform, Project Graph, Effect evaluation, Composition, Driver Host or Publish.

## Authority boundaries

**Launchwright owns:** release briefs, target context, local source declarations, scenarios, claims, CopyBlocks, ReleaseContracts, immutable editorial artifacts, exact candidate manifests, editorial decisions, verifier/waiver ledgers, channel package manifests, local audit events, portable snapshots and local recovery state.

**Semwright owners remain authoritative for:** native driver execution and Host isolation, canonical Graph observations, canonical effects, Platform jobs/budgets, Composition/AV rendering, canonical verifier admission and external Publish receipts.

The application never converts an imported declaration, screenshot, capture receipt, model result or waiver into a canonical PASS by serialization.

## Request path

UI, public HTTP client, CLI and Native Application bridge converge on `LaunchwrightApplication`. Mutations are bound to an exact request digest, workspace revision, epoch and principal. SQLite commits business data, durable mutation receipt and audit event in one transaction.

Lost replies are recovered by request identity. Reusing an idempotency key with another body conflicts. Observation pagination is bound to one workspace revision.

## Data model

Mutable application resources have stable IDs, opaque generations and monotonic string revisions. Immutable outputs include artifacts, candidates, verification records, waivers, delivery receipts and impact proposals. Retirement preserves identity as a redacted tombstone instead of silently deleting history.

Artifacts store exact SHA-256-addressed bytes. Candidate v2 freezes artifact hashes plus media metadata, target fingerprints, protected input revisions, claims, ReleaseContract, selected localization/glossary revisions, channel profiles, declared rights, destination and review policy. A protected change makes the old candidate stale rather than silently updating it.

## Capture and verification

`capture.ingest` records a Semwright/native/imported execution receipt against an approved source, exact build, target and scenario. It is provenance. Its technical state remains UNKNOWN until a verifier with the required authority establishes otherwise.

`verification.record` stores verifier identity/version/digest, dimension, coverage, omissions and findings. A PASS is effective only when the caller was provisioned with canonical verifier admission and the record is admitted as canonical. FAIL/ERROR remain failures. A waiver annotates a failure and never rewrites its state.

## Channels

A `channel_profile` is versioned product-owned configuration. `channel.package` generates an immutable package manifest pinned to candidate and profile versions but performs no network send. The authenticated loopback download route reconstructs a deterministic ZIP from that manifest, the frozen candidate manifest and content-addressed artifact blobs; repeated downloads therefore preserve exact bytes without storing another mutable archive. External outcomes are separate receipt records. UNKNOWN on non-idempotent/recover-first profiles requires recovery before retry. Public activation requires canonical Publish receipt admission.

## Portability

Portable snapshots contain application entities, content-addressed blobs, aliases, pending records and audit history. Historical request receipts are exported for forensic continuity but intentionally not activated during restore. Restored uncertain intents are marked `RESTORE_RECONCILE_REQUIRED`.
