# Integration gaps

These are explicit integration gaps, not implied application successes.

| Area | Current Launchwright behavior | External authority still required |
| --- | --- | --- |
| Browser/product capture | Stores approved source/scenario contracts plus capture-contract v2: exact Platform/native receipt correlation, readiness/anchors, drift, isolation/cleanup and provenance/derivative eligibility | Semwright browser/native driver execution and Host acceptance |
| Project Graph | Stores declared/imported relations and impact proposals | Canonical Graph observation, completeness and CURRENT/STALE verdicts |
| Effects | Scenarios can declare bounded effects | Canonical Effect evaluator and admitted receipts |
| Media | VTT timing and text artifacts are local | Composition timeline, render and media verification |
| Verification | Full immutable verifier/coverage/finding ledger; canonical PASS gated | Canonical verifier admission/runtime |
| Platform work | Durable intent and pending/recovery custody | Platform scheduler, budget and job authority |
| Platform Publish / third-party product | ReleaseTemplate/ProductVersion/deployment contracts plus a separate-process loopback consumer with bounded bearer identity, parameter/budget checks, principal-bound prepared requests, per-consumer invocation isolation and receipt recovery | Real Semwright Publish deployment, cross-tenant identity/entitlements, metering, job execution and output ACL authority. The immutable pinned Semwright main snapshot `4d291de26724810017ce7b6d185326514cb79fa6` contains no tracked `publish.define`, `publish.deploy`, `publish.invoke`, `ProductVersion` Publish surface or `@semwright/platform-client`; application-side rehearsal therefore remains non-canonical. |
| Public delivery | Exact channel packages and receipt ledger | Canonical Publish action/receipt and destination-specific authority |
| Teams | Principal/scopes work locally | Remote authentication, tenant isolation and multi-user approvals |
| Mobile/Godot | Provenance can be imported | Canonical native drivers and real target execution |
| Plugin/ChatGPT host | Native Application bridge is implemented | Host-side product acceptance |

No application-side schema should be promoted to an upstream Semwright API merely because it is useful locally.
