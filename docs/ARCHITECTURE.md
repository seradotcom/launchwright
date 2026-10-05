# Architecture

Launchwright owns release-domain state and delegates runtime authority to Semwright instead of rebuilding Semwright inside the application.

## Boundaries

`src/application.mjs` is the application authority. HTTP, CLI, browser UI and the native bridge reach the same dispatcher and SQLite transactions. Mutations use exact Native SDK request digests, workspace compare-and-swap versions, durable receipts and recovery.

`src/store.mjs` owns local persistence. Domain entities, immutable blob bytes, audit events, request receipts, private aliases and outstanding Platform request exports are distinct tables. Artifact bytes are SHA-256 checked on every read.

`src/native-entry.mjs` and `crates/launchwright-native` adapt Launchwright to the canonical Semwright Native SDK/NativeDriver surface. They are not a second protocol.

`src/platform.mjs` is an optional boundary to the owner-supplied, byte-pinned Semwright Platform Client. It negotiates actions, persists an exported pending request before one network send and uses recovery after an unknown outcome. It deliberately refuses unsupported public delivery.

## Release graph

The local model includes Product, Build, Release, Source, Target, Feature, Availability, Anchor, Scenario, Claim, CopyBlock, ReleaseContract, Relation, Evidence, Deliverable, Artifact, Candidate, Review, Delivery, Binding, Template, ChannelProfile, Bundle, ImpactProposal and Work.

Local Relation and Impact records are explicitly incomplete unless admitted by canonical Graph authority. Imported evidence never manufactures technical PASS.

## Candidate and channel boundary

A Candidate freezes exact artifact hashes, input versions, destination, review contract and selected ChannelProfile versions. Editing a pinned input makes the candidate stale.

Review dimensions are independent: technical, editorial and permissions. A waiver is durable review data and does not promote technical UNKNOWN or FAIL.

`candidate.export_bundle` creates deterministic ZIP bytes and records a Bundle in `EXPORTED_NOT_DELIVERED` state. Export and private-draft delivery are separate mutations. External publishing is not inferred from either one.

## Portability

`src/portable.mjs` exports a manifest plus exact blobs using the bounded ZIP implementation in `src/zip.mjs`. Restore validates paths, CRCs and SHA-256 before writing into a temporary workspace and atomically renaming it.

Receipts, pending dispatch and the session token are intentionally not portable. A restored workspace gets a new generation.

## Security properties in the current local mode

The HTTP service binds loopback, rejects unexpected Host/Origin/cross-site requests, forbids query parameters on local routes and uses an HttpOnly SameSite session cookie. Mutation bodies are bounded and validated by the Native SDK value rules. Source URLs reject userinfo, query strings and fragments; non-loopback sources require an approved purpose.

These controls are local single-owner controls, not SaaS tenant isolation.
