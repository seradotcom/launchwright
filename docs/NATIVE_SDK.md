# Canonical Semwright Native SDK integration

Launchwright pins Semwright commit `4d291de26724810017ce7b6d185326514cb79fa6` and Native SDK `0.9.0-dev.1`. Exact public SDK source hashes are in `../SOURCE_LOCK.json`. The pin was rechecked against Semwright `main` on 2026-10-05 and matched the current remote main SHA.

The JavaScript application imports the real `@semwright/native-sdk` package for application contexts, exact request digests, JSON budgets, cancellation, observations, recovery and dispatch. The vendored SDK keeps its upstream MIT OR Apache-2.0 licensing.

## Host bridge profiles

The canonical `NodeBridge` limits an owner-pinned executable bundle to 48 KiB and limits bundle plus invocation stdin to 64 KiB. Launchwright does not raise or bypass those limits. Its 66 public application operations are partitioned, without overlap, across seven owner-pinned bridge profiles:

| Profile | Operations | Local compacted bytes | Purpose |
| --- | ---: | ---: | --- |
| `core` | 13 | 44,559 | workspace/entity/history/event reads, entity CRUD, change proposals and template instantiation |
| `production` | 9 | 44,001 | coverage/impact, relations, evidence, capture-contract ingestion and text rendering |
| `review` | 9 | 47,553 | candidate, verification, waiver and channel-package lifecycle |
| `integrations` | 14 | 48,283 | localization, source-profile preflight, extension descriptors, compatibility locks, mobile import/inspection and channel status |
| `work` | 6 | 30,126 | snapshot summary and Platform-intent custody/recovery |
| `media` | 5 | 38,048 | media-plan inspection/revision and Composition output/editorial receipt custody |
| `publish` | 10 | 46,552 | ReleaseTemplate/ProductVersion/deployment/invocation contracts and authority-free export/import |

The byte counts above are workstation build evidence, not Driver Host acceptance. The narrowest current workstation headroom is 869 bytes in `integrations`. Operation metadata is isolated in `src/operations.mjs` so validation-heavy profiles do not pull the full operation table through `contracts.mjs`; this recovered bundle margin without weakening validation or changing the canonical bridge limits.

`scripts/build-native-bundle.mjs` refuses to build if an operation is missing, duplicated or if any compacted profile exceeds the canonical 48 KiB maximum. It emits a manifest containing the exact SHA-256 and byte count of every profile. The Rust driver pins all seven hashes at build time and maps each `driver.launchwright.*` operation to exactly one `NodeBridge`.

The split is an installation profile, not a second application protocol. Every profile still uses the same SQLite workspace transaction model and canonical bridge schema. `core` also supplies the observation and recovery providers.

Launchwright does not expose arbitrary Python/JavaScript execution, caller-selected runtime paths, dynamic mounts or a second protocol. Runtime acceptance still belongs to the real Semwright Host/Broker boundary; a successful local bridge test or Rust build is not a Host-isolation certificate.

The optional Platform adapter consumes an owner-supplied, byte-pinned client because the inspected Platform package is not licensed for redistribution in this public repository.
