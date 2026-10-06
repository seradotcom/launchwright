# Canonical Semwright Native SDK integration

Launchwright pins Semwright commit `4d291de26724810017ce7b6d185326514cb79fa6` and Native SDK `0.9.0-dev.1`. Exact public SDK source hashes are in `../SOURCE_LOCK.json`. The pin was rechecked against Semwright `main` on 2026-10-05 and matched the current remote main SHA.

The JavaScript application imports the real `@semwright/native-sdk` package for application contexts, exact request digests, JSON budgets, cancellation, observations, recovery and dispatch. The vendored SDK keeps its upstream MIT OR Apache-2.0 licensing.

## Host bridge profiles

The canonical `NodeBridge` limits an owner-pinned executable bundle to 48 KiB and limits bundle plus invocation stdin to 64 KiB. Launchwright does not raise or bypass those limits. Its 70 public application operations are partitioned, without overlap, across ten owner-pinned bridge profiles:

| Profile | Operations | Local compacted bytes | Headroom to 48 KiB | Purpose |
| --- | ---: | ---: | ---: | --- |
| `core` | 13 | 44,633 | 4,519 | workspace/entity/history/event reads, entity CRUD, change proposals and template instantiation |
| `sources` | 2 | 25,312 | 23,840 | source-profile matrix/preflight, including exact browser/Godot runtime compatibility |
| `graph` | 2 | 26,175 | 22,977 | immutable Project Graph response inspection/recording; no admission authority of its own |
| `effects` | 2 | 29,742 | 19,410 | exact canonical immutable-artifact Effects result custody/inspection; no execution authority |
| `production` | 9 | 47,573 | 1,579 | coverage/impact, relations, evidence, capture ingestion and text rendering |
| `review` | 9 | 47,553 | 1,599 | candidate, verification, waiver and channel-package lifecycle |
| `integrations` | 12 | 47,401 | 1,751 | localization, extension descriptors, compatibility locks, mobile import/inspection and channel status |
| `work` | 6 | 35,421 | 13,731 | snapshot summary and Platform-intent custody/recovery, including Graph preparation |
| `media` | 5 | 38,048 | 11,104 | media-plan and Composition receipt custody |
| `publish` | 10 | 46,944 | 2,208 | publish-product contracts and authority-free export/import |

The byte counts above are workstation build evidence, not Driver Host acceptance. The narrowest headroom is 1,579 bytes in `production`. Project Graph custody is isolated in `graph`; canonical immutable-artifact Effects result custody is isolated in `effects`. The public protocol contains 70 operations, with each of those authority-sensitive surfaces occupying its dedicated profile.

`scripts/build-native-bundle.mjs` rejects missing/duplicate operations and any profile above the canonical 48 KiB maximum. The Rust driver pins all ten hashes and maps each `driver.launchwright.*` operation to exactly one `NodeBridge`. Its `graph` and `effects` features come from the exact Semwright Native SDK pin; Launchwright does not expose Host, Graph or Effects admission authority to ordinary application callers.

The split is an installation profile, not a second application protocol. Every profile still uses the same SQLite workspace transaction model and canonical bridge schema. `core` still supplies the observation and recovery providers; `sources` is read-only and contains no alternate execution kernel.

Launchwright does not expose arbitrary Python/JavaScript execution, caller-selected runtime paths, dynamic mounts or a second protocol. Runtime acceptance still belongs to the real Semwright Host/Broker boundary; a successful local bridge test or Rust build is not a Host-isolation certificate.

The optional Platform adapter consumes an owner-supplied, byte-pinned client because the inspected Platform package is not licensed for redistribution in this public repository.
