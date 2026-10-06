# Canonical Semwright Native SDK integration

Launchwright pins Semwright commit `4d291de26724810017ce7b6d185326514cb79fa6` and Native SDK `0.9.0-dev.1`. Exact public SDK source hashes are in `../SOURCE_LOCK.json`. The pin was rechecked against `origin/main` on 2026-10-06 and still exactly matches the current Semwright main SHA.

The JavaScript application imports the real `@semwright/native-sdk` package for application contexts, exact request digests, JSON budgets, cancellation, observations, recovery and dispatch. The vendored SDK keeps its upstream MIT OR Apache-2.0 licensing.

## Host bridge profiles

The canonical `NodeBridge` limits an owner-pinned executable bundle to 48 KiB and limits bundle plus invocation stdin to 64 KiB. Launchwright does not raise or bypass those limits. Its 84 public application operations are partitioned, without overlap, across ten owner-pinned bridge profiles:

| Profile | Operations | R9 historical compacted bytes | Purpose |
| --- | ---: | ---: | --- |
| `core` | 13 | 46,007 | workspace/entity/history reads, entity CRUD, change proposals and template instantiation |
| `production` | 6 | 42,528 | release coverage, evidence, capture-contract ingestion and text rendering |
| `review` | 8 | 47,219 | candidate, verification, waiver, private delivery and channel packaging |
| `integrations` | 7 | 34,179 | localization, source-profile preflight, channel status and external channel outcome custody |
| `extensions` | 13 | 42,597 | extension descriptors, exact-use preparation, generic results, compatibility locks and CLI-source observation |
| `work` | 11 | 42,156 | snapshot summary, Platform-intent custody/recovery and application-side usage ledger |
| `media` | 5 | 39,969 | media-plan inspection/revision and Composition output/editorial receipt custody |
| `publish` | 10 | 48,469 | ReleaseTemplate/ProductVersion/deployment/invocation contracts and authority-free export/import |
| `graph` | 9 | 48,166 | Project Graph contract/inspection, owner-admitted observation custody, impact/reuse proposals and rebuild receipts |
| `effects` | 2 | n/a — introduced in R12 | canonical immutable-artifact Effects result custody and inspection, without execution authority |

The numeric byte counts above are exact historical R9 workstation evidence, not R12 bundle acceptance and not Driver Host acceptance. R12 adds the isolated `effects` profile; its exact compacted size and all ten current bundle hashes are accepted only from the exact-SHA `native` CI lane. The 48 KiB canonical limit is unchanged and must not be bypassed.

`scripts/build-native-bundle.mjs` refuses to build if an operation is missing, duplicated or if any compacted profile exceeds the canonical 48 KiB maximum. It emits a manifest containing the exact SHA-256 and byte count of every profile. The Rust driver pins all ten hashes at build time and maps each `driver.launchwright.*` operation to exactly one `NodeBridge`.

The split is an installation profile, not a second application protocol. Every profile still uses the same SQLite workspace transaction model and canonical bridge schema. `core` also supplies the observation and recovery providers. The dedicated `graph` profile isolates Graph custody from general production. The new `effects` profile isolates Effects readback custody and does not grant `canonical_effect_admission` merely by being selected; admission remains an explicit trusted-session capability. Actual execution/Host authority remains with Semwright.

Launchwright does not expose arbitrary Python/JavaScript execution, caller-selected runtime paths, dynamic mounts or a second protocol. Runtime acceptance still belongs to the real Semwright Host/Broker boundary; a successful local bridge test or Rust build is not a Host-isolation certificate.

## Real Driver Host acceptance

The selective GitHub Actions `host` lane is the acceptance path for Launchwright's own NativeDriver. It checks out the exact Semwright SHA from `SOURCE_LOCK.json`, configures Semwright's disposable-runner sandbox profile, builds the real Semwright daemon/CLI/sandbox and the real Launchwright NativeDriver, and stages all ten reviewed NodeBridge bundles plus a SHA-pinned Node 24 runtime. The test then executes through **CLI → daemon → Broker/Policy → Driver Host → Launchwright NativeDriver → Host-mediated sealed Node tool → owner-pinned bundle → SQLite workspace**.

`scripts/verify-native-host.py` verifies provider provenance and descriptor/generation bindings, performs a durable mutation and readback, proves the old opaque native ref is unusable after daemon/Host restart while application state persists, rejects an invalid request digest without changing the workspace revision, and repeats the route with `driver:launchwright` removed from policy to prove fail-closed denial. The harness is CI-only and refuses to substitute an in-process Provider.

A green `host` lane is exact-SHA evidence for this Driver Host/Broker/Policy boundary. It is **not** Semwright Cloud/Platform acceptance, remote tenant authentication, Platform Publish acceptance, public-channel delivery, canonical Graph traversal, broad mutation/noninterference Effects acceptance, or ChatGPT host acceptance. Those authorities remain separate.

The optional Platform adapter consumes an owner-supplied, byte-pinned client because the inspected Platform package is not licensed for redistribution in this public repository.
