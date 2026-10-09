# Contract mapping — canonical source versus application domain

The master specification contains *proposed* interfaces. They are not automatically Semwright SDK features. Below are interfaces evidenced by the inspected application and the pinned Semwright Native SDK. Revisions and exact ownership remain mandatory.

| Concern | Existing Launchwright interface | Authority and source | Gap |
| --- | --- | --- | --- |
| Resource IDs, versions, CAS | Native Application, entity.create/update, resource.get, history.* | Real @semwright/native-sdk v1 and app-owned SQLite | Remote multi-tenant authority not admitted |
| Immutable outputs | deliverable.render, artifact.read/download, candidate.freeze/inspect | Native SDK dispatcher; exact blob hashes and pinned source/target revisions | New output backends and production content review |
| External source consent | source contracts, profile preflight, R32/R35 Git import | Declared owner source; selected fixed Driver SDK lab providers | Customer runtime capture approval and host job/tenant correlation |
| Known graph impact | graph.observation_record and impact.plan/coalesce/receipt_record | Owner-scoped canonical Graph projection plus declared edges | Complete customer project discovery/extraction |
| Effects | effects.record/inspect; R29 Host-fixed provider | Exact spec/result native reader and Driver Host, scoped immutable artifact | Arbitrary mutation-effect/noninterference proofs |
| Media/time | media plan, Composition single-recipe harness | Canonical Semwright Composition + Audio/MLT, owned DeltaDesk only | User project, variants, editorial review and multi-format conformance |
| Verifier | verification.record, verification.summary, bounded format/credential-exposure Host receipts | Candidate-bound owner admitted evidence; no general privacy/rights truth | Broader independent oracles and production admission |
| Channel custody | channel profiles, channel.package, channel.record_outcome; owner GitHub Release *draft* CLI | Application domain packaging and operator-reported external draft | Real GitHub API acceptance, store/CMS/docs-PR publication |
| Publish product | publish.template_create, version_freeze, invocation/deployment rehearsal | Local application-only contracts and consumer loopback | Canonical Semwright Platform Publish API, cross-tenant ACL/meters/jobs |
| Usage/cost | usage.reserve/record/adjust; test billing callback | Application-local custody/projection | Canonical shared Platform budget, metering and real billing |
| External client | client/index.mjs | Public loopback HTTP contract | Remote identities/auth, deployed service and ACLs |
| MCP entry | scripts/mcp-local.mjs and stdio tools | Official MCP SDK, exclusively over public Launchwright Client SDK | Real ChatGPT Plugin host acceptance/deep linking |
| Workspace state transfer | snapshot/restore, history migration | Existing local SQLite and strict portability contracts | Shared Platform persistence plus authorized large artifact transfer |

No useful application-side endpoint grants permission to implement a second Platform/Core. In particular, no tracked canonical source supports hypothetical publish.define, publish.deploy, publish.invoke, universal customer capture authority or unbounded arbitrary-project execution.

## Usage pattern

An agent or human: **discover actual capabilities → inspect exact resources → prepare an intent → durably preserve its key/request digest → explicitly submit → reconcile the original result → inspect evidence and review**. The browser, public Client SDK and local MCP adapter ultimately use the same Native SDK application dispatcher.

A document that links to a service, local Git commit or SDK type is not a valid execution receipt. SOURCE_IMPLEMENTED, NATIVE_TESTED, DRIVER_HOST_ACCEPTED, EXTERNAL_HOST_ACCEPTED and PILOT_ACCEPTED are distinct evidence levels.
