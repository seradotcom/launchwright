# Project Graph integration boundary

Launchwright consumes the canonical Project Graph owned by Semwright; it does not implement a second graph, scheduler or admission authority.

## Application contract

`work.prepare` supports `project.query`, `project.asset.inspect`, `project.asset.provenance`, `project.revisions`, `project.impact`, `project.manifest.export` and explicit `project.edge.declare`. The outgoing object follows the reviewed Semwright contract. Launchwright-only `bindings` map visible local resources to opaque Graph assets and retain exact resource versions plus a digest.

The adapter rejects filesystem-like root grants, unbound queried assets, duplicate bindings, oversized queries, traversal budgets above the canonical limits, unsupported relations and Graph mutation without explicit per-intent authorization.

## Response custody and authority

A Platform response must pass durable pending/recovery custody before `graph.record` can store a `graph_observation`. Stored JSON is not evidence admission. Without canonical Graph admission the record remains `platform-response-not-admitted` and `release.impact` keeps an unknown frontier.

An admitted observation remains usable only while its exact resource bindings and source work revision are current. Drift is reported as `STALE_LOCAL_BINDING`; history is never rewritten. Launchwright preserves canonical Graph payloads instead of deriving its own CURRENT/STALE verdict.

## Rebuild and reuse

`impact.plan` has `authority: NONE` and creates zero jobs. Coalescing creates a new proposal and unions every original cause. Local reuse hints are principal/release/workspace scoped, prohibit cross-principal reuse and require final verification; they are not Project Graph reuse certification.

## Acceptance boundary

Local tests prove serialization, binding, stale detection, bounded visibility and authority separation. Supported-engine GitHub checks must compile the real Rust NativeDriver and exact Semwright Native SDK pin. Live Host/Broker admission, authenticated Project access and an end-to-end canonical Graph execution receipt remain external gates.
