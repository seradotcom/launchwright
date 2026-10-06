# Launchwright

**Source-linked release production built on the canonical Semwright Native SDK.**

Launchwright keeps product/build context, scenarios, claims, immutable release materials, verifier evidence, exact-candidate review, channel packages and recovery history in one application-owned workspace.

> **Developer preview.** The repository deliberately does not claim that the complete private product specification has passed acceptance. The owned DeltaDesk laboratory has an exact Semwright Chromium interoperability lane; Launchwright prepares/records canonical Semwright `project.*` Project Graph contracts and now custodizes results from the exact Native SDK immutable-artifact Effects reader. Platform-admitted product capture, live Host/Broker admission of Graph observations, native application effect/noninterference verification, Composition media rendering, remote teams and public Publish remain external Semwright integration boundaries until exact receipts prove otherwise.

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
- capture contract v2 tied to source + build + target + scenario, with Platform/native receipt correlation, readiness checks, anchor cardinality, build-drift detection, isolation/cleanup bounds, provenance classes and derived-material lineage while technical state stays UNKNOWN;
- immutable verifier identity/version/digest, coverage, omissions and findings;
- waivers that annotate failures without changing verifier truth;
- versioned channel profiles, exact package generation, authenticated deterministic private ZIP bundles, and receipt/recovery state without performing the external send;
- source-linked localization with glossary revision pins, explicit rebase, RTL/font-rights/critical-term blockers and no invented language/layout PASS;
- bounded extension descriptors, discovery, retirement, source-profile preflight and compatibility locks without executing remote extension code;
- bounded mobile import packages for PNG/JPEG screenshots and MP4 screen recordings with non-symlink package roots, path containment, exact SHA-256, container/dimension checks, build/device/OS/locale/origin/rights provenance, immutable asset artifacts and candidate/channel packaging while admission remains `imported-unverified` and technical state remains `UNKNOWN`;
- a pinned Godot source profile bound to Semwright commit `4d291de…`, the canonical `semwright-godot-driver` and Godot 4.7.2, with logical project locators and exact runtime-pin preflight; generic CLI execution remains unavailable rather than falling back to an arbitrary shell;
- an owned two-build DeltaDesk web laboratory with en-US/es-MX demo surfaces, role/plan availability changes and checkout-copy/layout drift, plus a fail-closed browser runtime contract pinned to the reviewed Semwright `chromium` provider and executable digest; the heavy `deltadesk` lane exercises that provider for real without inventing a Platform capture receipt;
- versioned media plans with exact rational timing, source/claim pins, video/screenshot/interactive variants, per-variant reuse detection, sanitized interactive-source policy and independent technical/editorial state; Launchwright can now prepare an exact authority-free Motion Canvas Composition handoff manifest while canonical Composition remains the rendering authority;
- bounded Publish product contracts: editable ReleaseTemplate drafts, immutable ProductVersion pins, deployment lifecycle, isolated consumer invocations, idempotent attempt keys and authority-free export/import with explicit local rebind/recheck; external activation still belongs to Platform Publish;
- private-draft alias delivery with compare-and-swap;
- portable snapshot/restore v2 that preserves exact stored revision history, rotates workspace generation/request epoch, suspends uncertain intents, and accepts older snapshots without fabricating historical revisions;
- public HTTP client, browser UI, CLI and Native Application bridge sharing the same dispatcher and SQLite transaction model, with authenticated discovery, snapshot-bound event pagination and URL-addressable inspection state that performs no mutation; the HTTP client is independently packable as `@launchwright/client`, negotiates API/discovery compatibility, and is exercised from a clean install with no private application imports.

## Semwright Native SDK

The public `@semwright/native-sdk` source is vendored unchanged under its upstream **MIT OR Apache-2.0** license. `SOURCE_LOCK.json` pins:

- Semwright commit `4d291de26724810017ce7b6d185326514cb79fa6`
- Native SDK `0.9.0-dev.1`
- exact SHA-256 hashes for the redistributed SDK files/archive

The canonical `NodeBridge` allows at most 48 KiB per owner-pinned executable bundle. Launchwright therefore maps all 71 public operations exactly once across ten bounded profiles (`core`, `sources`, `graph`, `effects`, `production`, `review`, `integrations`, `work`, `media`, `publish`) instead of weakening that upstream limit. Project Graph and canonical immutable-artifact Effects custody have dedicated `graph` and `effects` bundles; source-profile reads have their own `sources` bundle. `scripts/build-native-bundle.mjs` hashes every exact bundle and rejects missing/duplicate operations or oversized output. `crates/launchwright-native` pins all ten hashes at build time.

The optional Platform adapter consumes an owner-supplied byte-pinned package. The inspected Platform source is not licensed for redistribution, so it is not copied into this public repository.

## Trust model

Launchwright keeps **production, verification, review and delivery** separate.

A successful capture contract can establish that an authorized receipt, readiness conditions, unique anchors and provenance were recorded; it does not establish semantic correctness or Driver Host acceptance. Generated/editorial/imported material is never eligible to stand in for observed product state, and a sanitized derivative only preserves that eligibility when its exact parent capture did and every declared transformation preserves observed state. A heuristic/model/local PASS remains effective UNKNOWN unless admitted by canonical verifier authority. A waiver records an exception but never turns FAIL into PASS. A channel package says bytes are ready; it does not mean they were uploaded or published. A local ReleaseTemplate/ProductVersion/deployment contract likewise does not prove a remote consumer job ran. Public activation requires a canonical Publish receipt.

Launchwright local input-pin comparisons are not Project Graph completeness. A current owner-admitted `project.impact` response may be preserved and surfaced as canonical Graph authority, but Launchwright never recomputes that verdict and invalidates the local binding when any pinned application revision changes. Canonical Native SDK JSON/CSV artifact readback is separately supported and still does not prove a scenario's declared native effects or noninterference. Real execution of the reviewed Semwright Chromium adapter against owned DeltaDesk proves that interoperability path only; it is not a Platform job or admitted `capture.ingest` receipt. A `media_plan`, its authority-free `media.composition_manifest` and its Composition receipt ledger preserve exact handoff intent, source pins, capture correlations and provenance but are not a local AV renderer; Platform/Broker/Driver Host still resolve executable locators, grants and render execution, and VTT timing is not Composition rendering. Private editorial approval is not Host acceptance.

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
- **godot** — checks out the exact reviewed Semwright SHA, verifies the pinned Godot 4.7.2 binary, runs the production Godot driver against the real engine, and binds that trace to Launchwright source-profile preflight without inventing Platform/Host authority;
- **deltadesk** — starts the owned DeltaDesk A/B product, binds the disposable Ubuntu runner's `/opt/google/chrome/chrome` exactly as Semwright's own Chromium CI does, drives the real reviewed Semwright Chromium semantic adapter, retains exact PNG/receipt evidence and binds the observed runtime to Launchwright without claiming Platform capture admission;
- **stress** — bounded high-volume persistence, observation and portable-restore acceptance.

Run expensive dependencies on GitHub Actions rather than the development workstation.

## Documentation

- [Install](docs/INSTALL.md)
- [Architecture and authority boundaries](docs/ARCHITECTURE.md)
- [Public HTTP, client and event contract](docs/API.md)
- [Native SDK integration](docs/NATIVE_SDK.md)
- [Canonical Effects readback custody](docs/EFFECTS.md)
- [Mobile import contract](docs/MOBILE_IMPORT.md)
- [Godot source profile and real-engine lane](docs/GODOT_SOURCE.md)
- [DeltaDesk owned browser laboratory](docs/DELTADESK_LAB.md)
- [Known SDK/platform gaps](docs/SDK_GAPS.md)
- [Storage and portability](docs/PORTABILITY.md)
- [Operator runbook](docs/RUNBOOK.md)
- [Requirements traceability](docs/REQUIREMENTS.md)
- [Acceptance ledger](docs/ACCEPTANCE.md)

## License

New Launchwright code is **AGPL-3.0-only**. Canonical Semwright SDK files retain **MIT OR Apache-2.0** and their original notices.

The private source specification, credentials, private runtime state, browser profiles, product captures and unlicensed Platform source are not part of this public repository.
