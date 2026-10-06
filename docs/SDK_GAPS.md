# Integration gaps

These are explicit integration gaps, not implied application successes.

| Area | Current Launchwright behavior | External authority still required |
| --- | --- | --- |
| Browser/product capture | Stores approved source/scenario contracts plus capture-contract v2: exact Platform/native receipt correlation, readiness/anchors, drift, isolation/cleanup and provenance/derivative eligibility | Semwright browser/native driver execution and Host acceptance |
| Project Graph | Prepares canonical `project.*` reads plus `project.edge.declare`, binds exact local revisions, records immutable response digests, preserves admitted output verbatim and invalidates stale local bindings | Live Host/Broker admission, authenticated Project access and end-to-end CURRENT/STALE evidence on a supported runner |
| Effects | Stores exact results from the pinned Native SDK immutable JSON/CSV Effects reader, exact artifact/scenario revision bindings and owner-gated admission; dedicated CI lane runs the real upstream binary | Native application mutation/noninterference effects, Driver Host admission and scenario-effect coverage on a supported real runner |
| Media | VTT timing and text artifacts are local | Composition timeline, render and media verification |
| Verification | Admin-protected verifier profiles are pinned by exact revision/digest into candidates; reports bind exact candidate/artifact/target context, expose coverage/omissions and make incomplete/drifted PASS UNKNOWN; FAIL/ERROR and waivers preserve truth | Canonical verifier execution/runtime and owner admission on a supported Host |
| Platform work | Durable intent, pending/recovery custody and exact reservation/usage/adjustment receipt ledger | Platform scheduler, quota enforcement, authoritative metering/billing and job authority |
| Usage/billing | Estimate-vs-measured, BYO separation, bounded perf samples and test-only callback custody | Real Platform ledger/quota, invoice provider, live charge and production SLO authority |
| Public delivery | Exact channel packages and receipt ledger | Canonical Publish action/receipt and destination-specific authority |
| Teams | Principal/scopes work locally | Remote authentication, tenant isolation and multi-user approvals |
| Mobile/Godot | Provenance can be imported | Canonical native drivers and real target execution |
| Plugin/ChatGPT host | Native Application bridge is implemented | Host-side product acceptance |

No application-side schema should be promoted to an upstream Semwright API merely because it is useful locally.


## R17 extension boundary

Launchwright now has a dedicated Native SDK `extensions` profile for extension discovery/registration/retirement and compatibility negotiation/inspection/locking. It deliberately does not create a second package registry or Driver SDK host. Real package distribution, approvals, revocation enforcement in running jobs, runtime isolation and executable renderer/provider code remain Platform/Host responsibilities and require their own acceptance evidence.
