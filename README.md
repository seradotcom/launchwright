# Launchwright

**Source-linked release production built on the canonical Semwright Native SDK.**

Launchwright keeps product/build context, scenarios, claims, immutable release materials, verifier evidence, exact-candidate review, channel packages and recovery history in one application-owned workspace.

> **Developer preview.** The repository deliberately does not claim that the complete private product specification has passed acceptance. Launchwright has an owned synthetic DeltaDesk A/B lane that executes the exact pinned Semwright Chromium semantic adapter and a selective real-media lane that can turn those retained capture bytes into a 20-second H.264/AAC MP4 through the pinned Semwright MLT Driver Host while separately exercising the canonical Composition + Audio AV E2E at the same Semwright SHA. Those two proofs remain deliberately distinct: a single owner-admitted Composition recipe consuming the real captures, canonical customer-product/Platform admission, live Project Graph traversal, canonical effects, remote teams and public Publish remain external boundaries until exact receipts prove them.

## Run locally

Use Node **24.21.x**.

```sh
npm ci --ignore-scripts --no-audit --no-fund
node src/main.mjs init --state .state
node src/main.mjs serve --state .state --port 4317
```

Open `http://127.0.0.1:4317` and unlock it with the local `.state/session-token`. The service is loopback-only, rejects query-string credentials and unexpected Host/Origin values, and uses an HttpOnly SameSite session cookie.

For a bounded local consumer rehearsal, `serve --consumer-auth FILE` (or `LAUNCHWRIGHT_CONSUMER_AUTH`) accepts a private `0600` JSON file with schema `launchwright-consumer-auth/1` and principals restricted to the `consume` scope. Consumer bearer credentials cannot create the owner session cookie, read owner workspace resources without `read`, reuse another principal's prepared mutation, or recover another principal's receipt. This is a loopback acceptance surface only; it is not Semwright Platform tenant authentication or a substitute for Platform Publish.

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
- explicit relation provenance plus an immutable, owner-admitted Semwright Project Graph projection with bounded visible-node impact, preserved UNKNOWN frontiers, exact-revision impact proposals/coalescing, conservative reuse assessment and rebuild/finalization receipts; local heuristics never promote themselves to Graph authority;
- exact-base document change proposals that cannot force-overwrite newer edits;
- exact candidate manifests that pin artifact bytes, target context, ReleaseContract, localization/glossary revisions, channel profiles and declared rights, with input freshness and review-race isolation;
- capture contract v2 tied to source + build + target + scenario, with Platform/native receipt correlation, readiness checks, anchor cardinality, build-drift detection, isolation/cleanup bounds, provenance classes and derived-material lineage while technical state stays UNKNOWN;
- owned DeltaDesk A/B browser laboratory exercised by the exact pinned Semwright Chromium semantic adapter in a dedicated heavy CI lane; its real adapter receipts and screenshot hashes are preserved as `IMPORTED_UNVERIFIED` capture records rather than promoted to canonical Platform/Host evidence;
- immutable verifier identity/version/digest, coverage, omissions and findings;
- waivers that annotate failures without changing verifier truth;
- versioned channel profiles, exact package generation, authenticated deterministic private ZIP bundles, and receipt/recovery state without performing the external send;
- source-linked localization with glossary revision pins, explicit rebase, RTL/font-rights/critical-term blockers and no invented language/layout PASS;
- bounded extension descriptors, discovery, retirement, source-profile preflight and compatibility locks without executing remote extension code;
- versioned media plans with exact rational timing, source/claim pins, video/screenshot/interactive variants, per-variant reuse detection, sanitized interactive-source policy and independent technical/editorial state; the heavy real-media path preserves exact DeltaDesk screenshot hashes through Semwright Driver Host/MLT into a retained 20-second MP4 and cross-checks the canonical Composition AV stack at the same source SHA without falsely treating those separate proofs as one Composition recipe;
- bounded Publish product contracts: editable ReleaseTemplate drafts, immutable ProductVersion pins, deployment lifecycle, isolated consumer invocations, idempotent attempt keys and authority-free export/import with explicit local rebind/recheck; external activation still belongs to Platform Publish;
- private-draft alias delivery with compare-and-swap;
- portable snapshot/restore v2 that preserves exact stored revision history, rotates workspace generation/request epoch, suspends uncertain intents, and accepts older snapshots without fabricating historical revisions;
- read-only `doctor` diagnostics plus a clean-room operator rehearsal that checks the pinned Native SDK, local state safety and portable restore without inheriting author secrets or machine paths;
- application-side usage reservations and idempotent usage receipts, with measured/estimated/BYO separation, auditable corrections, explicit overrun visibility and test-only billing callbacks; these records are projections and never claim Platform billing authority;
- bounded extension runtime receipts for owner-controlled renderer/importer fixtures, with exact preparation pins, rights checks, output budgets, retirement-aware freshness and explicit UNKNOWN technical state until canonical Host admission.
- public HTTP client, browser UI, CLI and Native Application bridge sharing the same dispatcher and SQLite transaction model.

## Semwright Native SDK

The public `@semwright/native-sdk` source is vendored unchanged under its upstream **MIT OR Apache-2.0** license. `SOURCE_LOCK.json` pins:

- Semwright commit `4d291de26724810017ce7b6d185326514cb79fa6`
- Native SDK `0.9.0-dev.1`
- exact SHA-256 hashes for the redistributed SDK files/archive

The canonical `NodeBridge` allows at most 48 KiB per owner-pinned executable bundle. Launchwright therefore maps all 82 public operations exactly once across nine bounded profiles (`core`, `production`, `review`, `integrations`, `extensions`, `work`, `media`, `publish`, `graph`) instead of weakening that upstream limit. `scripts/build-native-bundle.mjs` hashes each exact bundle and rejects missing/duplicate operations or oversized output. `crates/launchwright-native` pins all nine hashes at build time. The caller cannot choose arbitrary executable code, mounts or runtime paths; the dedicated `graph` profile is the only Native profile provisioned for owner-admitted Graph projections.

The optional Platform adapter consumes an owner-supplied byte-pinned package. The inspected Platform source is not licensed for redistribution, so it is not copied into this public repository.

## Trust model

Launchwright keeps **production, verification, review and delivery** separate.

A successful capture contract can establish that an authorized receipt, readiness conditions, unique anchors and provenance were recorded; it does not establish semantic correctness or Driver Host acceptance. Generated/editorial/imported material is never eligible to stand in for observed product state, and a sanitized derivative only preserves that eligibility when its exact parent capture did and every declared transformation preserves observed state. A heuristic/model/local PASS remains effective UNKNOWN unless admitted by canonical verifier authority. A waiver records an exception but never turns FAIL into PASS. A channel package says bytes are ready; it does not mean they were uploaded or published. A local ReleaseTemplate/ProductVersion/deployment contract likewise does not prove a remote consumer job ran. Public activation requires a canonical Publish receipt.

An owner-admitted Project Graph observation can project canonical snapshot/impact knowledge into Launchwright, but local input-pin comparisons, declared/imported/heuristic relations and cache hits are not Project Graph completeness or admission. Partial visibility, missing dependencies and truncated/cancelled traversal preserve UNKNOWN frontiers. Scenario effect declarations are not canonical effects. A `media_plan` and its Composition receipt ledger preserve handoff intent and provenance but are not a local AV renderer. The selective real-media lane proves real captured bytes can traverse the pinned Semwright MLT Driver Host to MP4 and independently proves the canonical AV coordinator on the same Semwright SHA; until one admitted Composition recipe owns both legs, the combined Launchwright state remains `UNKNOWN` rather than technical PASS. Private editorial approval is not Host acceptance.

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

GitHub Actions runs the supported Node 24.21 runtime on Linux, Windows and macOS. The manual heavy workflow has five independently selectable lanes:

- **native** — builds the pinned TypeScript SDK, native bundle and real Rust NativeDriver;
- **browser** — installs Chromium on the runner and exercises the real Launchwright UI;
- **deltadesk** — executes the owned DeltaDesk A/B fixture through the exact pinned Semwright Chromium semantic adapter, retains screenshots/receipts and ingests them as `IMPORTED_UNVERIFIED` capture evidence without fabricating Platform or Host authority;
- **composition** — recaptures DeltaDesk A/B with that exact adapter, feeds the retained PNG bytes into the pinned Semwright MLT driver inside Driver Host to create a 600-frame/20-second MP4, separately executes Semwright's canonical Composition + Audio AV E2E at the same source SHA, and emits a fail-closed cross-system report whose technical state stays `UNKNOWN` until one canonical recipe joins the two proofs;
- **stress** — bounded high-volume persistence, observation and portable-restore acceptance.

Run expensive dependencies on GitHub Actions rather than the development workstation.

## Documentation

- [Install](docs/INSTALL.md)
- [Architecture and authority boundaries](docs/ARCHITECTURE.md)
- [Native SDK integration](docs/NATIVE_SDK.md)
- [Project Graph projection and impact](docs/PROJECT_GRAPH.md)
- [DeltaDesk real-browser laboratory](docs/DELTADESK_LAB.md)
- [Known SDK/platform gaps](docs/SDK_GAPS.md)
- [Storage and portability](docs/PORTABILITY.md)
- [Operations, metering and cost projection](docs/OPERATIONS_AND_COSTS.md)
- [Operator runbook](docs/RUNBOOK.md)
- [Requirements traceability](docs/REQUIREMENTS.md)
- [Acceptance ledger](docs/ACCEPTANCE.md)

## License

New Launchwright code is **AGPL-3.0-only**. Canonical Semwright SDK files retain **MIT OR Apache-2.0** and their original notices.

The private source specification, credentials, private runtime state, browser profiles, product captures and unlicensed Platform source are not part of this public repository.

### Extensibility reference path

Launchwright includes a bounded extension registry/preparation contract and an executable fixtures/deltacli.mjs second-source fixture. The fixture produces a real process receipt; Launchwright deliberately keeps its technical state UNKNOWN until canonical Driver Host admission is available.
