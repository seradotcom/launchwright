# Launchwright

**Source-linked release production built on the canonical Semwright Native SDK.**

Launchwright keeps product/build context, scenarios, claims, immutable release materials, verifier evidence, exact-candidate review, channel packages and recovery history in one application-owned workspace.

> **Developer preview.** The repository deliberately does not claim that the complete private product specification has passed acceptance. Real product capture, canonical Project Graph/effects, Composition media rendering, Platform execution, remote teams and public Publish remain external Semwright integration boundaries until exact receipts prove otherwise.

## Run locally

Use Node **24.21.x**.

```sh
npm ci --ignore-scripts --no-audit --no-fund
node src/main.mjs init --state .state
node src/main.mjs serve --state .state --port 4317
```

Open `http://127.0.0.1:4317` and unlock it with the local `.state/session-token`. The service is loopback-only, rejects query-string credentials and unexpected Host/Origin values, and uses an HttpOnly SameSite session cookie.

For explicitly synthetic sample data:

```sh
node src/main.mjs demo --state .state
```

Synthetic data is never described as a real product capture.

## What works today

- stable resource IDs, opaque generations, monotonic string revisions and optimistic concurrency;
- durable exact entity revision history with bounded get/list/diff operations, explicit legacy migration, and no invented pre-migration revisions;
- build/source/target/feature/scenario/anchor modeling with explicit source authorization;
- claims, CopyBlocks, availability rules and ReleaseContract readiness denominators;
- immutable Markdown, safe HTML, JSON, email-draft and VTT artifacts with SHA-256-addressed bytes;
- explicit relation provenance, impact projections, immutable impact proposals and exact-base document change proposals that cannot force-overwrite newer edits;
- exact candidate manifests that pin artifact bytes, target context, ReleaseContract, localization/glossary revisions, channel profiles and declared rights, with input freshness and review-race isolation;
- Semwright/native capture **receipt ingestion** tied to source + build + target + scenario while technical state stays UNKNOWN;
- immutable verifier identity/version/digest, coverage, omissions and findings;
- waivers that annotate failures without changing verifier truth;
- versioned channel profiles, exact package generation, authenticated deterministic private ZIP bundles, and receipt/recovery state without performing the external send;
- source-linked localization with glossary revision pins, explicit rebase, RTL/font-rights/critical-term blockers and no invented language/layout PASS;
- bounded extension descriptors, discovery, retirement, source-profile preflight and compatibility locks without executing remote extension code;
- private-draft alias delivery with compare-and-swap;
- portable snapshot/restore v2 that preserves exact stored revision history, rotates workspace generation/request epoch, suspends uncertain intents, and accepts older snapshots without fabricating historical revisions;
- public HTTP client, browser UI, CLI and Native Application bridge sharing the same dispatcher and SQLite transaction model.

## Semwright Native SDK

The public `@semwright/native-sdk` source is vendored unchanged under its upstream **MIT OR Apache-2.0** license. `SOURCE_LOCK.json` pins:

- Semwright commit `4d291de26724810017ce7b6d185326514cb79fa6`
- Native SDK `0.9.0-dev.1`
- exact SHA-256 hashes for the redistributed SDK files/archive

The canonical `NodeBridge` allows at most 48 KiB per owner-pinned executable bundle. Launchwright therefore maps all 49 public operations exactly once across five bounded profiles (`core`, `production`, `review`, `integrations`, `work`) instead of weakening that upstream limit. `scripts/build-native-bundle.mjs` hashes each exact bundle and rejects missing/duplicate operations or oversized output. `crates/launchwright-native` pins those five hashes at build time. The caller cannot choose arbitrary executable code, mounts or runtime paths.

The optional Platform adapter consumes an owner-supplied byte-pinned package. The inspected Platform source is not licensed for redistribution, so it is not copied into this public repository.

## Trust model

Launchwright keeps **production, verification, review and delivery** separate.

A successful capture receipt says that an execution receipt was recorded; it does not establish semantic correctness. A heuristic/model/local PASS remains effective UNKNOWN unless admitted by canonical verifier authority. A waiver records an exception but never turns FAIL into PASS. A channel package says bytes are ready; it does not mean they were uploaded or published. Public activation requires a canonical Publish receipt.

Local input-pin comparisons are not Project Graph completeness. Scenario effect declarations are not canonical effects. VTT timing is not Composition rendering. Private editorial approval is not Host acceptance.

## Backup and recovery

```sh
node src/main.mjs snapshot --state .state --out launchwright-snapshot.json
node src/main.mjs restore --snapshot launchwright-snapshot.json --state .state-restored
```

Restore preserves domain identities, content hashes and exact stored entity history but creates a new workspace generation, advances the request epoch, leaves old mutation receipts inactive and marks uncertain pending work for explicit reconciliation.

Workspaces created before schema v2 remain readable but reject new mutations until the explicit history migration is run with node src/main.mjs migrate-history --state .state. That migration backfills only the current revision actually present for each entity. Earlier revisions are marked as not reconstructed rather than inferred from events or receipts.

## Verification

Lightweight:

```sh
npm test
node scripts/verify.mjs
node src/main.mjs doctor --state .state
```

GitHub Actions runs the supported Node 24.21 runtime on Linux, Windows and macOS. The manual heavy workflow has three independently selectable lanes:

- **native** — builds the pinned TypeScript SDK, native bundle and real Rust NativeDriver;
- **browser** — installs Chromium on the runner and exercises the real Launchwright UI;
- **stress** — bounded high-volume persistence, observation and portable-restore acceptance.

Run expensive dependencies on GitHub Actions rather than the development workstation.

## Documentation

- [Install](docs/INSTALL.md)
- [Architecture and authority boundaries](docs/ARCHITECTURE.md)
- [Native SDK integration](docs/NATIVE_SDK.md)
- [Known SDK/platform gaps](docs/SDK_GAPS.md)
- [Storage and portability](docs/PORTABILITY.md)
- [Operator runbook](docs/RUNBOOK.md)
- [Requirements traceability](docs/REQUIREMENTS.md)
- [Acceptance ledger](docs/ACCEPTANCE.md)

## License

New Launchwright code is **AGPL-3.0-only**. Canonical Semwright SDK files retain **MIT OR Apache-2.0** and their original notices.

The private source specification, credentials, private runtime state, browser profiles, product captures and unlicensed Platform source are not part of this public repository.
