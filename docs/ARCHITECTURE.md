# Architecture

Launchwright is an application layer over Semwright contracts, not a replacement for Semwright Platform, Project Graph, Effect evaluation, Composition, Driver Host or Publish.

## Authority boundaries

**Launchwright owns:** release briefs, target context, local source declarations, scenarios, claims, CopyBlocks, ReleaseContracts, ReleaseTemplate drafts, immutable ProductVersion contracts, local deployment/invocation records, immutable editorial artifacts, exact candidate manifests, editorial decisions, verifier/waiver ledgers, channel package manifests, local audit events, portable snapshots and local recovery state.

**Semwright owners remain authoritative for:** native driver execution and Host isolation, canonical Graph observations, canonical effects, Platform jobs/budgets, Composition/AV rendering, canonical verifier admission and external Publish receipts.

The application never converts an imported declaration, screenshot, capture receipt, model result or waiver into a canonical PASS by serialization.

## Request path

UI, public HTTP client, CLI and Native Application bridge converge on `LaunchwrightApplication`. Mutations are bound to an exact request digest, workspace revision, epoch and principal. SQLite commits business data, durable mutation receipt and audit event in one transaction.

Lost replies are recovered by request identity. Reusing an idempotency key with another body conflicts. Observation pagination is bound to one workspace revision.

## Data model

Mutable application resources have stable IDs, opaque generations and monotonic string revisions. Schema v2 archives the exact entity row after every create/update/retire into a separate revision-history table. history.get, history.list and history.diff expose those stored revisions through the same application dispatcher and canonical Native core profile. Legacy schema-v1 workspaces require an explicit migration before another mutation; migration snapshots only the current rows that actually exist and records pre-migration history as NOT_RECONSTRUCTED.

Immutable outputs include artifacts, candidates, verification records, waivers, delivery receipts, impact proposals, document change proposals and their application receipts. A document proposal is bound to the exact resource revision and payload digest it was created from; newer edits make it stale instead of being force-overwritten. Human-owned CopyBlocks and whole-document proposals require explicit human acknowledgement before application. Retirement preserves identity as a redacted tombstone and its tombstone revision is archived instead of silently deleting history.

Artifacts store exact SHA-256-addressed bytes. Candidate v2 freezes artifact hashes plus media metadata, target fingerprints, protected input revisions, claims, ReleaseContract, selected localization/glossary revisions, channel profiles, declared rights, destination and review policy. A protected change makes the old candidate stale rather than silently updating it.

## Project Graph projection and impact

Launchwright consumes Semwright Project Graph through a versioned projection contract locked to the same Semwright source SHA as the Native SDK. It does not ship another graph traversal kernel. An admitted observation is immutable and carries project/snapshot identity, traversal budgets, visible asset mappings, canonical edges/evidence, known/possible impact, UNKNOWN frontier and explicit inventory denominator metadata. Hits and edges that refer to resources outside the authorized visible projection are rejected rather than leaking a hidden dependency path.

The normal HTTP/CLI application session cannot manufacture canonical Graph authority. Only the dedicated owner-pinned `graph` Native profile is provisioned for the application-side admission path, and that path still requires an already completed Platform work record, native receipt digest and `canonical-owner-admitted` result. In the real Rust driver, the bundle is pinned at build time and canonical `NodeBridge` execution additionally requires a Host-mediated sealed runtime tool. Local direct-process profile tests are regression evidence, not Host-isolation acceptance.

Declared/imported/heuristic relations remain local records. `observed` relation provenance requires an exact observed/executed edge in an admitted Graph observation. The application preserves canonical knowledge dimensions and never collapses incomplete coverage into CURRENT. Cycles are not walked locally: Launchwright accepts only already-bounded traversal reports and preserves truncation/cancellation as an UNKNOWN frontier.

Impact planning remains proposal-first. Plans are bound to exact cause revisions and carry no execution authority. Coalescing preserves every changed revision, including multiple revisions of the same resource. Rebuild receipts partition those exact revisions into built versus pending and require a new finalization result for a new final delivery. Cache/reuse assessment binds artifact inputs, target, toolchain, scenario fixtures, templates, verifier versions, tenant, rights, permissions, locale and output profile; a cache hit is never an access grant or inherited final PASS. See `PROJECT_GRAPH.md` for the full boundary.

## Capture and verification

`capture.ingest` records a versioned Launchwright capture contract against an approved source, exact build, target and scenario. Observed capture classes require Platform-job correlation plus a native receipt digest, successful runs require READY checks and exact scenario-anchor cardinality, mutable scenarios require scoped isolation, cleanup cannot remove resources outside the run-owned set, and before/after build observations fail on drift. Sanitized derivatives retain an exact parent-capture relation; generated/editorial/imported material is explicitly ineligible to represent observed product state. This is still provenance, not Host acceptance: technical state remains UNKNOWN until a verifier with the required authority establishes otherwise.

`verification.record` stores verifier identity/version/digest, dimension, coverage, omissions and findings. A PASS is effective only when the caller was provisioned with canonical verifier admission and the record is admitted as canonical. FAIL/ERROR remain failures. A waiver annotates a failure and never rewrites its state. R26 established candidate-wide format verification through the fixed Semwright Driver SDK provider, Broker/Policy/Driver Host and exact Native receipt admission. R30 adds a separate lexical credential-exposure dimension for supported text bytes with redacted findings; a PASS never satisfies broad privacy. Normal HTTP/UI callers cannot mint canonical Host receipts.

## Canonical Effects readback custody

`effects.record` consumes the exact pinned Native SDK immutable-artifact Effects result schema; Launchwright does not implement another evaluator. It stores the protected spec and result bytes by SHA-256, binds exact artifact revisions plus an optional scenario revision, rejects decisive results that do not cover the complete bound artifact set, and recalculates effective state against current bytes/revisions. A canonical PASS is effective only behind explicit `canonical_effect_admission`; a recorded but non-admitted PASS stays UNKNOWN, while canonical FAIL stays FAIL.

This surface remains limited to immutable-artifact readback. R29 accepted the fixed canonical Effects reader/evaluator via Broker/Policy/Driver Host and exact Native receipt admission without conferring execution authority. The upstream scope is `immutable_native_sdk_artifact_properties_only`, with `execution_authority:false` and `scenario_effects_covered:false`. Native/browser/Godot mutation effects, noninterference and authoritative scenario effects remain separate Semwright-owned gates.

## Media composition custody

`media.plan` records a versioned, source-linked production plan with exact rational duration/frame-rate data, observed capture references, sanitized interactive derivatives, narration/music/caption assets, and independent video/screenshot-series/interactive-demo variants. Plans pin every referenced resource revision and compute per-variant digests so a revision can identify which variants remain reusable instead of invalidating unrelated outputs.

Launchwright deliberately does not implement a second media clock, effects kernel, browser kernel or renderer. Motion Canvas handoff and AV execution remain Semwright-owned. Historical R11 evidence kept real-capture MLT rendering and canonical AV coordination as separate proofs. The R24 candidate removes that evidence split for the owned synthetic fixture without forking the kernel: a fail-closed transformer accepts only the reviewed pinned `combined_native.rs` bytes, stages the exact R23 Broker-captured PNGs read-only, imports them as digest-bound managed Motion Canvas assets, and lets the canonical Semwright Composition coordinator continue through Driver Host/MLT, exhaustive audio/sync verification and publication. Launchwright retains and re-hashes the resulting MP4 and evidence. `composition-single-recipe` may report technical PASS only inside the exact-SHA owned-fixture scope; `IMPORTED_UNVERIFIED` capture authority, human approval, Platform execution, customer acceptance and editorial approval remain separate and cannot be inferred from that receipt.

## Channels

A `channel_profile` is versioned product-owned configuration. `channel.package` generates an immutable package manifest pinned to candidate and profile versions but performs no network send. The authenticated loopback download route reconstructs a deterministic ZIP from that manifest, the frozen candidate manifest and content-addressed artifact blobs; repeated downloads therefore preserve exact bytes without storing another mutable archive. External outcomes are separate receipt records. UNKNOWN on non-idempotent/recover-first profiles requires recovery before retry. Public activation requires canonical Publish receipt admission.

## Publish product contracts

A `release_template` is an editable application-owned contract over explicitly authorized source/scenario/claim IDs, bounded public parameters, output classes, destinations, verification dimensions, disclosures, budgets and retention. `publish.version_freeze` creates an immutable `product_version` with exact resource revision pins and a digest; later template edits do not alter that version.

A `publish_deployment` points to one exact ProductVersion and has an explicit ACTIVE → DEPRECATED → RETIRED lifecycle. Consumer invocation preparation accepts only the version's parameter surface, rejects URL/path/secret-style parameter names and out-of-scope resource options, applies a budget ceiling, and deduplicates `(consumer, deployment, invocation_key)` without sharing owner workspace read access. Retiring a deployment blocks new invocations while preserving prior invocation/result custody according to the declared retention contract.

The loopback HTTP server can provision bounded bearer principals for consumer rehearsal. Every request opens the application under that authenticated principal and its exact scopes. Prepared HTTP mutations use a principal-bound v2 envelope; a different principal cannot send it, and durable receipt recovery rechecks the stored principal before returning a result. Consumer credentials never become owner browser cookies. This proves application-side identity/ACL separation on one local workspace, not cross-tenant Platform execution.

Export serializes only the authorized contract/pins and explicitly carries no credentials, grants or permissions. Import requires caller-supplied local resource rebindings and an explicit contract recheck before the imported template may be frozen again. Platform-facing publish work is bound to the exact local template/version/deployment/invocation revision and digest and fails stale before send if that binding changes. These records are preparation/custody only: actual cross-account execution, metering, output ACL enforcement and external activation remain Platform Publish authority.


## Extensibility and non-DOM sources

Extension manifests are bounded descriptors, not executable grants. `extension.prepare_use` freezes the exact extension resource version, package version and digest for one declared input/output contract. Retiring the package blocks new starts and makes existing preparations report `REVOKED_FOR_NEW_START` without deleting historical preparations or observations. Generic views expose typed plain metadata with no trusted markup, remote code execution or capability grant.

The reference second source is an executable CLI fixture. Its process is run outside the application contract, then `source.cli_ingest` records bounded stdout/stderr, exact process timing/exit status, approved source/build pins and optional source-adapter pins. The observation can be inspected for source/target/adapter drift. A successful exit is recorded as process success only; technical state remains `UNKNOWN` because this application does not claim canonical Driver Host isolation or admission from a process receipt.

Extension execution evidence uses the same conservative boundary. `extension.result_record` accepts only a prepared output type, enforces the package output budget, pins the exact preparation/package revision and digest, and records technical state as `UNKNOWN` with `host_isolation_verified=false`. `extension.result_inspect` reports drift/retirement without deleting history. The owned DeltaRender fixture exercises the deliverable-renderer path; the owned mobile importer normalizes a bounded externally supplied bundle and explicitly reports that no device execution was observed.

## Portability

Portable snapshot v2 contains application entities, exact entity revision history, migration provenance, content-addressed blobs, aliases, pending records and audit events. Historical request receipts are exported for forensic continuity but intentionally not activated during restore. Restored uncertain intents are marked RESTORE_RECONCILE_REQUIRED.

Restore also accepts the older snapshot-v1 envelope. Because v1 did not carry entity-history rows, restore archives only each current entity revision and records that earlier snapshot history was NOT_RECONSTRUCTED; it never synthesizes old revisions from audit events.
