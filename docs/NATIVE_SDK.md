# Canonical Semwright Native SDK integration

Launchwright pins Semwright commit `4d291de26724810017ce7b6d185326514cb79fa6` and Native SDK `0.9.0-dev.1`. Exact public SDK source hashes are in `../SOURCE_LOCK.json`. The pin was rechecked against `origin/main` on 2026-10-06 and still exactly matches the current Semwright main SHA.

The JavaScript application imports the real `@semwright/native-sdk` package for application contexts, exact request digests, JSON budgets, cancellation, observations, recovery and dispatch. The vendored SDK keeps its upstream MIT OR Apache-2.0 licensing.

## Host bridge profiles

The canonical `NodeBridge` limits an owner-pinned executable bundle to 48 KiB and limits bundle plus invocation stdin to 64 KiB. Launchwright does not raise or bypass those limits. Its 82 public application operations are partitioned, without overlap, across nine owner-pinned bridge profiles:

| Profile | Operations | Local compacted bytes | Purpose |
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

The byte counts above are workstation build evidence, not Driver Host acceptance. The Graph operations were isolated from `production` rather than granting the general production bundle canonical Graph admission. The tightest profile is `publish` with 683 bytes of headroom; `graph` retains 986 bytes. No canonical limit was raised or bypassed.

`scripts/build-native-bundle.mjs` refuses to build if an operation is missing, duplicated or if any compacted profile exceeds the canonical 48 KiB maximum. It emits a manifest containing the exact SHA-256 and byte count of every profile. The Rust driver pins all nine hashes at build time and maps each `driver.launchwright.*` operation to exactly one `NodeBridge`.

The split is an installation profile, not a second application protocol. Every profile still uses the same SQLite workspace transaction model and canonical bridge schema. `core` also supplies the observation and recovery providers. The dedicated `graph` profile is the only Native profile provisioned with the application-side Graph admission capability; actual admission still depends on Semwright Host/Project Graph authority and Host-mediated sealed runtime execution.

Launchwright does not expose arbitrary Python/JavaScript execution, caller-selected runtime paths, dynamic mounts or a second protocol. Runtime acceptance still belongs to the real Semwright Host/Broker boundary; a successful local bridge test or Rust build is not a Host-isolation certificate.

The optional Platform adapter consumes an owner-supplied, byte-pinned client because the inspected Platform package is not licensed for redistribution in this public repository.
