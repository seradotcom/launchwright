# Architecture

Launchwright is an application layer over Semwright contracts, not a replacement for Semwright Platform, Project Graph, Effect evaluation, Composition, Driver Host or Publish.

## Authority boundaries

**Launchwright owns:** release briefs, target context, local source declarations, scenarios, claims, CopyBlocks, ReleaseContracts, ReleaseTemplate drafts, immutable ProductVersion contracts, local deployment/invocation records, immutable editorial artifacts, exact candidate manifests, editorial decisions, verifier/waiver ledgers, channel package manifests, local audit events, portable snapshots and local recovery state.

**Semwright owners remain authoritative for:** native driver execution and Host isolation, canonical Graph observations, Effect evaluation authority (including native mutation/noninterference), Platform jobs/budgets, Composition/AV rendering, canonical verifier admission and external Publish receipts. Launchwright may preserve a result emitted by the exact pinned Native SDK immutable-artifact Effects reader, but that custody does not transfer evaluator or execution authority.

The application never converts an imported declaration, screenshot, capture receipt, model result or waiver into a canonical PASS by serialization.

## Request path

UI, public HTTP client, CLI and Native Application bridge converge on `LaunchwrightApplication`. Mutations are bound to an exact request digest, workspace revision, epoch and principal. SQLite commits business data, durable mutation receipt and audit event in one transaction.

Lost replies are recovered by request identity. Reusing an idempotency key with another body conflicts. Entity observation pagination is bound to one workspace revision. Audit-event pagination is independently frozen to the durable event watermark established on its first page; later commits cannot appear inside that snapshot. Event envelopes carry a durable ID/sequence, application source, workspace generation, committed revision and original request cause.

The authenticated loopback API exposes discovery before inventory use, so public clients can inspect exact operations/scopes, route names, event semantics and authority boundaries instead of assuming capabilities. Browser inspection state can be encoded as `#<section>/<resource-id>`; resolving or reloading that link performs discovery and read-only observation only, never an implicit mutation.

## Data model

Mutable application resources have stable IDs, opaque generations and monotonic string revisions. Schema v2 archives the exact entity row after every create/update/retire into a separate revision-history table. history.get, history.list and history.diff expose those stored revisions through the same application dispatcher and canonical Native core profile. Legacy schema-v1 workspaces require an explicit migration before another mutation; migration snapshots only the current rows that actually exist and records pre-migration history as NOT_RECONSTRUCTED.

Immutable outputs include artifacts, candidates, verification records, waivers, delivery receipts, impact proposals, document change proposals and their application receipts. A document proposal is bound to the exact resource revision and payload digest it was created from; newer edits make it stale instead of being force-overwritten. Human-owned CopyBlocks and whole-document proposals require explicit human acknowledgement before application. Retirement preserves identity as a redacted tombstone and its tombstone revision is archived instead of silently deleting history.

Artifacts store exact SHA-256-addressed bytes. Candidate v2 freezes artifact hashes plus media metadata, target fingerprints, protected input revisions, claims, ReleaseContract, selected localization/glossary revisions, channel profiles, declared rights, destination and review policy. A protected change makes the old candidate stale rather than silently updating it.

## Project Graph custody

Launchwright does not implement a parallel dependency graph. `work.prepare` accepts canonical Semwright reads `project.query`, `project.asset.inspect`, `project.asset.provenance`, `project.revisions`, `project.impact` and `project.manifest.export`, plus explicit `project.edge.declare`. Launchwright-only resource bindings are removed from outgoing canonical arguments and retained separately as a digest-bound map from exact local revisions to opaque Graph assets. Named grants, page sizes, visible assets and traversal budgets are bounded before a Platform intent can exist.

A Platform payload must first pass through durable pending/recovery custody. `graph.record` then stores an immutable `graph_observation` bound to the exact work revision, action, project, result digest and local revision set. Serialized JSON remains `platform-response-not-admitted` unless the runtime is explicitly provisioned with canonical Graph admission. If a bound local revision or source-work revision changes, `graph.inspect` reports the observation stale and `release.impact` returns to an unknown frontier rather than inheriting a prior CURRENT verdict.

`release.impact` preserves admitted Graph output verbatim and never recomputes Project Graph freshness. Local reuse hints are scoped to workspace generation, principal and release, bind exact artifact/producer/target/input identity, prohibit cross-principal reuse and still require final verification. `impact.plan` remains an authority-free proposal; coalescing creates a new immutable proposal and unions every cause without dispatching jobs. An observed local relation must cite an exact admitted Graph observation.

## Effects readback custody

`effects.record` accepts only the exact `semwright-native-effects-result/1` envelope for the pinned Native SDK immutable-artifact reader. The result bytes are content-addressed, every decisive result must cover the exact bound Launchwright JSON/CSV artifact digests, and optional scenario association pins the exact scenario revision. The result itself always carries `execution_authority: false`.

A canonical-looking serialized PASS is not enough: without explicit owner `canonical_effect_admission`, its effective state remains UNKNOWN. Admitted results become stale when result bytes, artifact bytes, artifact inputs or the optional scenario revision drift. Even an admitted PASS sets `scenario_effects_covered: false`; immutable-artifact property readback is not native application mutation/noninterference verification. The dedicated heavy lane builds and executes the upstream `semwright-native-effects` binary rather than reimplementing its evaluator in Launchwright.

## Capture and verification

`capture.ingest` records a versioned Launchwright capture contract against an approved source, exact build, target and scenario. Observed capture classes require Platform-job correlation plus a native receipt digest, successful runs require READY checks and exact scenario-anchor cardinality, mutable scenarios require scoped isolation, cleanup cannot remove resources outside the run-owned set, and before/after build observations fail on drift. Sanitized derivatives retain an exact parent-capture relation; generated/editorial/imported material is explicitly ineligible to represent observed product state. This is still provenance, not Host acceptance: technical state remains UNKNOWN until a verifier with the required authority establishes otherwise.

Verifier profiles are admin-protected extension descriptors rather than producer-controlled payloads. A candidate that makes a verification dimension release-gating must pin an exact canonical verifier profile revision/digest whose policy declares complete coverage and negative controls. `verification.record` then binds the report to the exact candidate SHA-256, artifact revisions/bytes, optional target fingerprint, verifier profile, coverage, omissions and findings and stores a digest of that report context. A PASS is effective only when the caller was provisioned with canonical verifier admission, coverage is complete and every protected binding remains current; partial coverage or verifier/profile drift returns UNKNOWN, while FAIL/ERROR remain failures with an explicit next action. A waiver annotates a failure and never rewrites its state.

## Media composition custody

`media.plan` records a versioned, source-linked production plan with exact rational duration/frame-rate data, observed capture references, sanitized interactive derivatives, narration/music/caption assets, and independent video/screenshot-series/interactive-demo variants. Plans pin every referenced resource revision and compute per-variant digests so a revision can identify which variants remain reusable instead of invalidating unrelated outputs.

Launchwright deliberately does not implement a second media clock, effects kernel, or renderer. `media.composition_manifest` prepares a digest-bound, read-only handoff for the exact media-plan revision and variant, carrying source pins, capture/job/native-receipt correlations, ordered capture segments, asset provenance and the pinned Semwright snapshot. It names only the reviewed Motion Canvas operations `driver.motion-canvas.composition.plan`, `driver.motion-canvas.composition.apply`, `driver.motion-canvas.render.plan`, `driver.motion-canvas.render.execute` and `driver.motion-canvas.composition.verify`; it always sets execution authority and Host acceptance false. Missing observed-state eligibility, Platform/native correlation or capture segments blocks Platform resolution, stale inputs fail closed, and interactive-demo is not misrepresented as a Motion Canvas render target. A canonical Composition receipt can establish technical output state only when that admission capability is present; editorial review remains a separate decision bound to the exact artifact SHA-256. Imported output declarations never become canonical PASS merely because they were stored.

## Channels

A `channel_profile` is versioned product-owned configuration. `channel.package` generates an immutable package manifest pinned to candidate and profile versions but performs no network send. The authenticated loopback download route reconstructs a deterministic ZIP from that manifest, the frozen candidate manifest and content-addressed artifact blobs; repeated downloads therefore preserve exact bytes without storing another mutable archive. External outcomes are separate receipt records. UNKNOWN on non-idempotent/recover-first profiles requires recovery before retry. Public activation requires canonical Publish receipt admission.

## Publish product contracts

A `release_template` is an editable application-owned contract over explicitly authorized source/scenario/claim IDs, bounded public parameters, output classes, destinations, verification dimensions, disclosures, budgets and retention. `publish.version_freeze` creates an immutable `product_version` with exact resource revision pins and a digest; later template edits do not alter that version.

A `publish_deployment` points to one exact ProductVersion and has an explicit ACTIVE → DEPRECATED → RETIRED lifecycle. Consumer invocation preparation accepts only the version's parameter surface, rejects URL/path/secret-style parameter names and out-of-scope resource options, applies a budget ceiling, and deduplicates `(consumer, deployment, invocation_key)` without sharing owner workspace read access. Retiring a deployment blocks new invocations while preserving prior invocation/result custody according to the declared retention contract.

Export serializes only the authorized contract/pins and explicitly carries no credentials, grants or permissions. Import requires caller-supplied local resource rebindings and an explicit contract recheck before the imported template may be frozen again. Platform-facing publish work is bound to the exact local template/version/deployment/invocation revision and digest and fails stale before send if that binding changes. These records are preparation/custody only: actual cross-account execution, metering, output ACL enforcement and external activation remain Platform Publish authority.

## Portability

Portable snapshot v2 contains application entities, exact entity revision history, migration provenance, content-addressed blobs, aliases, pending records and audit events. Historical request receipts are exported for forensic continuity but intentionally not activated during restore. Restored uncertain intents are marked RESTORE_RECONCILE_REQUIRED.

Restore also accepts the older snapshot-v1 envelope. Because v1 did not carry entity-history rows, restore archives only each current entity revision and records that earlier snapshot history was NOT_RECONSTRUCTED; it never synthesizes old revisions from audit events.
