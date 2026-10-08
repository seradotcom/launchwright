# Canonical Semwright Native SDK integration

Launchwright vendors the published `@semwright/native-sdk` 1.0.0 TypeScript package from Semwright `v1.0.0` (`8fa191250ae68274182570c65f067f7a60f85625`), while Rust/Driver Host integration is pinned independently to reviewed Semwright source `d2da9a495a53fe279a1ca4de61f0e24646350f22`. That post-release main snapshot includes PR #250, which makes the canonical Effects reader compatible with exact Driver Host/Landlock mounts without granting parent-directory ReadDir authority. Exact package/source identities are recorded separately in `../SOURCE_LOCK.json`; later upstream commits are not inherited implicitly.

The JavaScript application imports the real `@semwright/native-sdk` package for application contexts, exact request digests, JSON budgets, cancellation, observations, recovery and dispatch. The vendored SDK keeps its upstream MIT OR Apache-2.0 licensing.

## Host bridge profiles

The canonical `NodeBridge` limits an owner-pinned executable bundle to 48 KiB and limits bundle plus invocation stdin to 64 KiB. Launchwright does not raise or bypass those limits. Its 86 public application operations are partitioned, without overlap, across thirteen owner-pinned bridge profiles:

| Profile | Operations | R9 historical compacted bytes | Purpose |
| --- | ---: | ---: | --- |
| `core` | 13 | 46,007 | workspace/entity/history reads, entity CRUD, change proposals and template instantiation |
| `production` | 6 | 42,528 | release coverage, evidence, capture-contract ingestion and text rendering |
| `review` | 7 | 47,219 | candidate inspection, verification summaries, waivers, private delivery and channel packaging |
| `verifier` | 1 | n/a — introduced in R26 | canonical verification recording and exact Driver Host receipt admission |
| `integrations` | 9 | 34,179 | localization, source-profile preflight, channel status and external channel outcome custody |
| `extensions` | 11 | 38,683 in current R28 workstation build | extension descriptors, exact-use preparation, discovery/inspection and compatibility locks |
| `extension_runtime` | 2 | 38,552 in current R28 workstation build | isolated receipt admission for bounded extension result/CLI execution; current sizes are supplemental until CI |
| `work` | 11 | 42,156 | snapshot summary, Platform-intent custody/recovery and application-side usage ledger |
| `media` | 5 | 39,969 | media-plan inspection/revision and Composition output/editorial receipt custody |
| `publish` | 10 | 48,469 | ReleaseTemplate/ProductVersion/deployment/invocation contracts and authority-free export/import |
| `graph` | 9 | 48,166 | Project Graph contract/inspection, owner-admitted observation custody, impact/reuse proposals and rebuild receipts |
| `effects` | 1 | n/a — introduced in R12 | read-only inspection of immutable-artifact Effects custody and freshness |
| `effects_runtime` | 1 | n/a — introduced in R29 | isolated exact Driver Host Effects receipt admission; no arbitrary execution or scenario-mutation authority |

The numeric byte counts above are exact historical R9 workstation evidence, not current bundle acceptance and not Driver Host acceptance. R12 added the isolated `effects` profile and R26 added the isolated `verifier` profile. R27 subsequently revalidated all eleven then-current profiles against Semwright v1.0.0. R28 added and exact-SHA accepted the twelfth `extension_runtime` profile in heavy all-lanes run `37720793885`. R29 adds the thirteenth `effects_runtime` profile; exact SHA `ac83fc358215ec629bf5d7b8abc9de699064862c` passed selective Native run `37725665684` and final all-lanes run `37727269373`, accepting the current thirteen bundle hashes without changing the canonical 48 KiB limit. R26 earned exact-SHA Native, Verifier and Host acceptance at `4b0a437ef2fbd67d199dcf33e0d0d405ef91e0ad`; R27 then revalidated the complete pre-R28 lane set against Semwright/Native SDK v1.0.0 in heavy run `37707577491`.

`scripts/build-native-bundle.mjs` refuses to build if an operation is missing, duplicated or if any compacted profile exceeds the canonical 48 KiB maximum. It emits a manifest containing the exact SHA-256 and byte count of every profile. The Rust driver pins all thirteen hashes at build time and maps each `driver.launchwright.*` operation to exactly one `NodeBridge`.

The split is an installation profile, not a second application protocol. Every profile still uses the same SQLite workspace transaction model and canonical bridge schema. `core` also supplies the observation and recovery providers. The dedicated `graph` profile isolates Graph custody from general production. The `effects` profile now isolates read-only Effects inspection, the R29 `effects_runtime` profile isolates exact Driver Host receipt admission, the R26 `verifier` profile isolates canonical verification recording plus its read-only receipt grant from the broader review surface, and the R28 `extension_runtime` profile isolates exact Driver Host execution receipts from extension discovery/registration. The normal application and general `extensions` profile cannot self-attach those canonical receipts. Selecting a profile does not manufacture upstream authority; admission remains explicit and evidence-bound. Actual execution/Host authority remains with Semwright.

Launchwright does not expose arbitrary Python/JavaScript execution, caller-selected runtime paths, dynamic mounts or a second protocol. Runtime acceptance still belongs to the real Semwright Host/Broker boundary; a successful local bridge test or Rust build is not a Host-isolation certificate.

## Real Driver Host acceptance

The selective GitHub Actions `host` lane is the acceptance path for Launchwright's own NativeDriver. It checks out the exact Semwright SHA from `SOURCE_LOCK.json`, configures Semwright's disposable-runner sandbox profile, builds the real Semwright daemon/CLI/sandbox and the real Launchwright NativeDriver, and stages all thirteen reviewed NodeBridge bundles plus profile-scoped SHA-pinned Node 24 runtimes. The test then executes through **CLI → daemon → Broker/Policy → Driver Host → Launchwright NativeDriver → Host-mediated sealed Node tool → owner-pinned bundle → SQLite workspace**.

`scripts/verify-native-host.py` verifies provider provenance and descriptor/generation bindings, performs a durable mutation and readback, proves the old opaque native ref is unusable after daemon/Host restart while application state persists, rejects an invalid request digest without changing the workspace revision, and repeats the route with `driver:launchwright` removed from policy to prove fail-closed denial. The harness is CI-only and refuses to substitute an in-process Provider.

A green `host` lane is exact-SHA evidence for this Driver Host/Broker/Policy boundary. It is **not** Semwright Cloud/Platform acceptance, remote tenant authentication, Platform Publish acceptance, public-channel delivery, canonical Graph traversal, broad mutation/noninterference Effects acceptance, or ChatGPT host acceptance. Those authorities remain separate.

The optional Platform adapter consumes an owner-supplied, byte-pinned client because the inspected Platform package is not licensed for redistribution in this public repository.
