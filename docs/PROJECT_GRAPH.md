# Canonical Project Graph projection

Launchwright does not implement a second dependency graph, traversal engine, freshness authority or effect evaluator. It consumes and stores bounded projections from Semwright Project Graph at the pinned reviewed Semwright source SHA `d2da9a495a53fe279a1ca4de61f0e24646350f22` (Native SDK API line 1.0.0; base release `8fa191250ae68274182570c65f067f7a60f85625`).

The machine-readable lock is `contracts/project-graph-contract.json`. JavaScript tests compare the public application contract with that file, while the Rust NativeDriver test compiles against `semwright-project-graph` at the same Git revision and checks the canonical relation serialization, schema version, traversal limits and presentation labels.

## Authority boundary

The normal HTTP/CLI/application session cannot promote caller data to canonical Graph authority. `graph.observation_record` requires an explicit `canonical_graph_admission` capability and an already completed durable work record bound to `graph.observation`, an exact result locator, a SHA-256 evidence binding and an owner-admitted result. The historical work-record field is named `platform_job_id`; R21 does not treat that storage field as proof of Platform scheduling or execution authority.

The dedicated `graph` Native profile is the owner-pinned adapter surface for that capability. In the real NativeDriver path its exact bundle hash is compiled into the Rust driver and the canonical Semwright `NodeBridge` additionally requires a Host-mediated sealed runtime tool profile. Local direct-process tests of that profile are regression evidence only; they are not a Driver Host isolation certificate. A machine owner with direct database/filesystem access is outside the application authorization boundary.

Launchwright stores the admitted projection immutably. It never admits its own heuristic relation, local revision comparison or cached artifact as a canonical Project Graph observation.

## R21 owner-controlled Broker/Host path

R21 adds a CI-only acceptance path over the exact pinned Semwright source. The harness creates two owned synthetic files inside an explicitly granted read-only project root, enables `project.manage` separately from `driver:launchwright`, and drives Semwright's real Broker routes for project creation, file-backed asset registration/reconciliation, a declared `references` edge, bounded query, bounded impact and portable-manifest export. A separate negative-control daemon omits `project.manage` and must reject project creation.

The exact Broker responses and the Launchwright projection are retained in a canonicalized Host transcript whose SHA-256 is bound into the durable work result. That projection is then recorded through the real Launchwright NativeDriver `graph` profile and read back through `graph.inspect` and `release.impact`. The acceptance flow restarts the daemon and requires both Semwright's private Project Graph state and Launchwright's admitted projection to survive under the durable owner identity.

The public Broker routes do not expose Semwright's internal observation-epoch token. R21 therefore labels the projection epoch as a Launchwright Host snapshot binding derived from the exact Project ID, Project Graph snapshot and pinned Semwright SHA; it is never represented as the hidden upstream epoch. Semwright also marks a `file_scope` query as `scope_partial:true` relative to the whole Project Graph even when that bounded authorized page is exhausted. Launchwright preserves that marker as `scope_partial:true` and `denominator_complete:false`; it does not reinterpret `next_cursor:null` as global completeness. Likewise, a generic Semwright file observation intentionally has unknown dependency coverage, and a manifest-exported declaration remains `declared`, not observed/executed evidence. Those dimensions keep the effective uncertainty visible instead of manufacturing a technical PASS.

The exact R21 source SHA `8de121fca5d81803c7781a2bca58d5344927a9cd` passed selective heavy Host run `37561836145`, job `112600625256`, against Semwright `4d291de26724810017ce7b6d185326514cb79fa6`. Artifact `11457174433` records schema `launchwright-native-host-acceptance/3`, live Broker Graph admission, Native projection custody, restart persistence and the separate `project.manage` denial control. That evidence is exact-SHA scoped.

This path establishes neither a Platform scheduler/job receipt nor real customer/project extraction. The accepted R21 report keeps `project_graph_platform_job_authority:false`, and the broader Platform/Publish boundaries remain separate.

## Canonical projection surface

The Graph profile owns nine application operations:

- `release.impact`
- `relation.record`
- `impact.plan`
- `graph.contract`
- `graph.inspect`
- `graph.cache_assess`
- `graph.observation_record`
- `impact.coalesce`
- `impact.receipt_record`

A stored graph observation carries the pinned Project Graph schema version, project/snapshot identity, traversal budget, known and possible impact hits, unknown-frontier/truncation/cancellation state, visible asset mapping, canonical relation kinds and evidence kinds, plus explicit inventory/denominator metadata.

Only resources present in the authorized visible projection may appear in returned hits or edges. A path through an unlisted/private node is rejected instead of being serialized. Launchwright does not traverse the projected edge set itself, so cycles cannot create an unbounded local walk; traversal cardinality/depth is accepted only inside a bounded canonical report.

## Knowledge and uncertainty

Launchwright preserves the canonical knowledge dimensions:

- existence: present / missing / unknown
- freshness: current / stale / unknown
- divergence: clean / diverged / unknown
- verification: PASS / FAIL / UNKNOWN
- dependency coverage and unknown frontier
- reconcile requirement

`CURRENT`, `STALE`, `UNKNOWN`, `MISSING` and `DIVERGED` are presentation labels only. Incomplete coverage remains visible even when a particular asset label is CURRENT. Truncated or cancelled impact reports must preserve an unknown frontier.

Declared, imported and heuristic local relations remain application records. An `observed` relation can be recorded only when the exact resource pair and canonical relation kind exist in an admitted Graph observation with observed/executed edge evidence. An inferred/heuristic edge never clears unknown coverage.

## Impact proposals and rebuild receipts

`impact.plan` produces an immutable proposal bound to exact cause revisions and the latest admitted graph observation when available. A proposal has `authority: NONE` and creates zero jobs.

`impact.coalesce` combines multiple immutable proposals without dropping revision identity. If one resource changed twice, both revision pins remain in the coalesced cause set even though the resource ID is listed once.

Execution remains a separate Platform work item. `impact.receipt_record` records a completed `recipes.execute` work item and requires every proposal cause revision to appear exactly once in either `built` or `pending`. A new final delivery must also carry an explicit finalization result and verifier version. Reusing intermediate material therefore never implies that a newly packaged output inherited an older PASS.

## Reuse assessment

`graph.cache_assess` is an assessment, not an execution grant. Its deterministic key binds:

- artifact bytes and exact input revision pins
- target revision and target data digest
- toolchain digest
- scenario/data-fixture digest
- template IDs, revisions and content digests
- verifier names, versions and digests
- tenant scope
- rights state
- permission fingerprint
- locale
- output-profile digest

A matching key is reusable only while artifact inputs are still current and access is safe. Changing a verifier, target, tenant, permissions, rights context or other bound dimension invalidates the old key. Identical bytes do not transfer access between tenants. Every new final delivery still requires revalidation.

## Coverage percentages

Launchwright never invents a global denominator. A percentage is emitted only when the observation declares a safe authorized visible denominator; `global_percentage` remains null. Partial/truncated/unknown inventory reports expose `UNSAFE_DENOMINATOR` and no percentage.

## What remains external

The projection layer does **not** establish:

- a second Project Graph discovery/traversal engine implemented by Launchwright (Launchwright delegates traversal to Semwright instead);
- real customer/project discovery, provider-specific dependency extraction and non-fixture scope/tenant acceptance beyond the owned R21 project;
- canonical effect evaluation;
- Driver Host isolation for real customer/project extraction beyond the exact owned R21 acceptance fixture;
- real Platform recipe execution;
- final external publication.

Those outcomes require exact Semwright Host/Platform receipts on the source SHA under test.
