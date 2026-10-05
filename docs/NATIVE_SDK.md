# Canonical Semwright Native SDK integration

Launchwright pins Semwright commit `4d291de26724810017ce7b6d185326514cb79fa6` and Native SDK `0.9.0-dev.1`. Exact public SDK source hashes are in `../SOURCE_LOCK.json`. The pin was rechecked against Semwright `main` on 2026-10-05 and matched the current remote main SHA.

The JavaScript application imports the real `@semwright/native-sdk` package for application contexts, exact request digests, JSON budgets, cancellation, observations, recovery and dispatch. The vendored SDK keeps its upstream MIT OR Apache-2.0 licensing.

## Host bridge profiles

The canonical `NodeBridge` limits an owner-pinned executable bundle to 48 KiB and limits bundle plus invocation stdin to 64 KiB. Launchwright does not raise or bypass those limits. Its 66 public application operations are partitioned, without overlap, across eight owner-pinned bridge profiles:

| Profile | Operations | Local compacted bytes | Headroom to 48 KiB | Purpose |
| --- | ---: | ---: | ---: | --- |
| `core` | 13 | 44,597 | 4,555 | workspace/entity/history/event reads, entity CRUD, change proposals and template instantiation |
| `sources` | 2 | 25,312 | 23,840 | source-profile matrix/preflight, including exact browser/Godot runtime compatibility |
| `production` | 9 | 44,001 | 5,151 | coverage/impact, relations, evidence, capture-contract ingestion and text rendering |
| `review` | 9 | 47,553 | 1,599 | candidate, verification, waiver and channel-package lifecycle |
| `integrations` | 12 | 47,271 | 1,881 | localization, extension descriptors, compatibility locks, mobile import/inspection and channel status |
| `work` | 6 | 30,126 | 19,026 | snapshot summary and Platform-intent custody/recovery |
| `media` | 5 | 38,048 | 11,104 | media-plan inspection/revision and Composition output/editorial receipt custody |
| `publish` | 10 | 46,552 | 2,600 | ReleaseTemplate/ProductVersion/deployment/invocation contracts and authority-free export/import |

The byte counts above are workstation build evidence, not Driver Host acceptance. The narrowest current headroom is 1,599 bytes in `review`. Source-profile matrix/preflight now live in their own `sources` bridge: this recovers 4,555 bytes of `core` headroom and lets browser/Godot compatibility evolve without weakening the canonical limit. The public operation names and application protocol did not change. Operation metadata remains isolated in `src/operations.mjs`.

`scripts/build-native-bundle.mjs` refuses to build if an operation is missing, duplicated or if any compacted profile exceeds the canonical 48 KiB maximum. It emits a manifest containing the exact SHA-256 and byte count of every profile. The Rust driver pins all eight hashes at build time and maps each `driver.launchwright.*` operation to exactly one `NodeBridge`.

The split is an installation profile, not a second application protocol. Every profile still uses the same SQLite workspace transaction model and canonical bridge schema. `core` still supplies the observation and recovery providers; `sources` is read-only and contains no alternate execution kernel.

Launchwright does not expose arbitrary Python/JavaScript execution, caller-selected runtime paths, dynamic mounts or a second protocol. Runtime acceptance still belongs to the real Semwright Host/Broker boundary; a successful local bridge test or Rust build is not a Host-isolation certificate.

The optional Platform adapter consumes an owner-supplied, byte-pinned client because the inspected Platform package is not licensed for redistribution in this public repository.
