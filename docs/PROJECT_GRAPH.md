# Canonical Project Graph projection

Launchwright does not implement a second dependency graph, traversal engine, freshness authority or effect evaluator. It consumes and stores bounded projections from Semwright Project Graph at the pinned Semwright source SHA `4d291de26724810017ce7b6d185326514cb79fa6`.

The machine-readable lock is `contracts/project-graph-contract.json`. JavaScript tests compare the public application contract with that file, while the Rust NativeDriver test compiles against `semwright-project-graph` at the same Git revision and checks the canonical relation serialization, schema version, traversal limits and presentation labels.

## Authority boundary

The normal HTTP/CLI/application session cannot promote caller data to canonical Graph authority. `graph.observation_record` requires an explicit `canonical_graph_admission` capability and an already completed Platform work record bound to `graph.observation`, a Platform job ID, a native receipt SHA-256 and an owner-admitted result.

The dedicated `graph` Native profile is the owner-pinned adapter surface for that capability. In the real NativeDriver path its exact bundle hash is compiled into the Rust driver and the canonical Semwright `NodeBridge` additionally requires a Host-mediated sealed runtime tool profile. Local direct-process tests of that profile are regression evidence only; they are not a Driver Host isolation certificate. A machine owner with direct database/filesystem access is outside the application authorization boundary.

Launchwright stores the admitted projection immutably. It never admits its own heuristic relation, local revision comparison or cached artifact as a canonical Project Graph observation.

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

- live Project Graph discovery/traversal performed by Launchwright;
- Project Graph owner authentication or Host admission;
- canonical effect evaluation;
- Driver Host isolation acceptance;
- real Platform recipe execution;
- final external publication.

Those outcomes require exact Semwright Host/Platform receipts on the source SHA under test.
