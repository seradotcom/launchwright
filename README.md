# Launchwright

**Source-linked release production built on the canonical Semwright Native SDK.**

Launchwright keeps product/build context, scenarios, claims, immutable release materials, verifier evidence, exact-candidate review, channel packages and recovery history in one application-owned workspace.

> **Developer preview.** The repository deliberately does not claim that the complete private product specification has passed acceptance. R23 proves the owned synthetic DeltaDesk A/B oracle through the exact pinned Semwright Broker + Policy + Chromium path while retaining human approval, Platform job authority, Driver Host isolation for browser capture and canonical customer-capture admission as unestablished. The R24 candidate now wires those exact Broker capture bytes, by SHA-256, into one canonical pinned Semwright Composition + Audio execution: the images become managed Motion Canvas assets, the same AV plan proceeds through Driver Host/MLT, exhaustive sync and pre/post-encode audio verification, and the final MP4/publication manifest are retained. R24 is not accepted until its exact source SHA passes supported-engine checks and the selective heavy `composition` lane. Even a green R24 is scoped to the owned synthetic fixture: capture authority remains `IMPORTED_UNVERIFIED`, and human approval, Platform execution, real-customer admission, editorial approval, external Publish and production deployment remain separate authorities. Launchwright continues to consume the pinned Semwright Native SDK rather than implementing a second automation/media kernel.

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
- canonical Native SDK Effects readback custody for immutable JSON/CSV artifacts: exact protected-spec/result bytes, source/runtime digests, exact artifact/scenario revision pins, owner-gated PASS admission and drift invalidation; `execution_authority` stays false and scenario mutation effects remain uncovered;
- exact-base document change proposals that cannot force-overwrite newer edits;
- exact candidate manifests that pin artifact bytes, target context, ReleaseContract, localization/glossary revisions, channel profiles and declared rights, with input freshness and review-race isolation;
- capture contract v2 tied to source + build + target + scenario, with Platform/native receipt correlation, readiness checks, anchor cardinality, build-drift detection, isolation/cleanup bounds, provenance classes and derived-material lineage while technical state stays UNKNOWN;
- owned DeltaDesk A/B browser laboratory exercised through the exact pinned Semwright Broker + Policy + Chromium path in a dedicated heavy CI lane; its real Broker-routed receipts and screenshot hashes are preserved as `IMPORTED_UNVERIFIED` capture records, fixture approval remains explicitly non-human, and no canonical Platform/Host authority is inferred;
- immutable verifier identity/version/digest, coverage, omissions and findings;
- waivers that annotate failures without changing verifier truth;
- versioned channel profiles, exact package generation, authenticated deterministic private ZIP bundles, and receipt/recovery state without performing the external send;
- source-linked localization with glossary revision pins, explicit rebase, RTL/font-rights/critical-term blockers and no invented language/layout PASS;
- bounded extension descriptors, discovery, retirement, source-profile preflight and compatibility locks without executing remote extension code;
- versioned media plans with exact rational timing, source/claim pins, video/screenshot/interactive variants, per-variant reuse detection, sanitized interactive-source policy and independent technical/editorial state; historical R11 evidence preserves the separate 20-second real-capture MLT derivative, while the R24 candidate uses the exact Broker A/B PNG hashes as managed Motion Canvas assets in a single canonical Semwright AV recipe and retains the resulting MP4 plus publication lineage without promoting fixture capture into customer/Platform authority;
- bounded Publish product contracts: editable ReleaseTemplate drafts, immutable ProductVersion pins, deployment lifecycle, isolated consumer invocations, idempotent attempt keys and authority-free export/import with explicit local rebind/recheck; external activation still belongs to Platform Publish;
- private-draft alias delivery with compare-and-swap;
- portable snapshot/restore v2 that preserves exact stored revision history, rotates workspace generation/request epoch, suspends uncertain intents, and accepts older snapshots without fabricating historical revisions;
- read-only `doctor` diagnostics plus a clean-room operator rehearsal that checks the pinned Native SDK, local state safety and portable restore without inheriting author secrets or machine paths;
- application-side usage reservations and idempotent usage receipts, with measured/estimated/BYO separation, auditable corrections, explicit overrun visibility and test-only billing callbacks; these records are projections and never claim Platform billing authority;
- bounded extension runtime receipts for owner-controlled renderer/importer fixtures, with exact preparation pins, rights checks, output budgets, retirement-aware freshness and explicit UNKNOWN technical state; R20 admits the extension **control plane** through canonical Driver Host without falsely claiming the separately executed fixture processes themselves are Host-isolated or technical PASS.
- public HTTP client, browser UI, CLI and Native Application bridge sharing the same dispatcher and SQLite transaction model.
- selective exact-SHA Driver Host acceptance that runs the real Launchwright NativeDriver through Semwright daemon/Broker/Policy, a sealed Node runtime and owner-pinned NodeBridge bundles; R20 admits the extension control plane and R21 additionally executes the owned Project Graph fixture through live Broker routes, persists the admitted bounded projection and verifies a separate `project.manage` denial control. This establishes only those owner-controlled Host paths and does not promote external Platform/Publish/ChatGPT authority.

## Semwright Native SDK

The public `@semwright/native-sdk` source is vendored unchanged under its upstream **MIT OR Apache-2.0** license. `SOURCE_LOCK.json` pins:

- Semwright commit `4d291de26724810017ce7b6d185326514cb79fa6`
- Native SDK `0.9.0-dev.1`
- exact SHA-256 hashes for the redistributed SDK files/archive

The canonical `NodeBridge` allows at most 48 KiB per owner-pinned executable bundle. Launchwright therefore maps all 84 public operations exactly once across ten bounded profiles (`core`, `production`, `review`, `integrations`, `extensions`, `work`, `media`, `publish`, `graph`, `effects`) instead of weakening that upstream limit. `scripts/build-native-bundle.mjs` hashes each exact bundle and rejects missing/duplicate operations or oversized output. `crates/launchwright-native` pins all ten hashes at build time. The caller cannot choose arbitrary executable code, mounts or runtime paths; the dedicated `graph` profile is the only Native profile provisioned for owner-admitted Graph projections.

The optional Platform adapter consumes an owner-supplied byte-pinned package. The inspected Platform source is not licensed for redistribution, so it is not copied into this public repository.

## Trust model

Launchwright keeps **production, verification, review and delivery** separate.

A successful capture contract can establish that an authorized receipt, readiness conditions, unique anchors and provenance were recorded; it does not establish semantic correctness or Driver Host acceptance. Generated/editorial/imported material is never eligible to stand in for observed product state, and a sanitized derivative only preserves that eligibility when its exact parent capture did and every declared transformation preserves observed state. A heuristic/model/local PASS remains effective UNKNOWN unless admitted by canonical verifier authority. A waiver records an exception but never turns FAIL into PASS. A channel package says bytes are ready; it does not mean they were uploaded or published. A local ReleaseTemplate/ProductVersion/deployment contract likewise does not prove a remote consumer job ran. Public activation requires a canonical Publish receipt.

An owner-admitted Project Graph observation can project canonical snapshot/impact knowledge into Launchwright, but local input-pin comparisons, declared/imported/heuristic relations and cache hits are not Project Graph completeness or admission. The exact R21 Host acceptance at SHA `8de121fca5d81803c7781a2bca58d5344927a9cd` drove the pinned Semwright Broker through `project.create`, file-backed asset registration/reconciliation, `project.edge.declare`, `project.query`, `project.impact` and `project.manifest.export`, then recorded that bounded owner-controlled result through the real Launchwright NativeDriver `graph` profile. Semwright correctly marks the file-scoped query `scope_partial:true`; Launchwright stores `denominator_complete:false` rather than inventing completeness. The integrated Native SDK Effects reader likewise preserves its narrower authority. For media, Launchwright still does not own a clock or renderer: the R24 candidate transforms only the exact reviewed Semwright AV acceptance harness, fail-closed by source SHA-256, so the retained Broker A/B bytes are imported as managed Motion Canvas assets and continue through the canonical Composition coordinator, Driver Host/MLT, exhaustive sync/audio verification and publication. `composition-single-recipe` can report fixture-scoped technical PASS only when those exact receipts and retained MP4 bytes agree; capture admission, human approval, Platform execution, real-customer acceptance and editorial state remain independent.

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

GitHub Actions runs the supported Node 24.21 runtime on Linux, Windows and macOS. The manual heavy workflow has seven independently selectable lanes:

- **native** — builds the pinned TypeScript SDK, all ten owner-pinned bundles and real Rust NativeDriver with Graph + Effects SDK features;
- **host** — checks out the exact pinned Semwright SHA and runs Launchwright through the real daemon → Broker/Policy → Driver Host → sealed Node runtime → owner-pinned NodeBridge bundle path, including durable mutation/readback, stale-ref invalidation across restart and a policy-denied negative control; a green exact-SHA run establishes this Host boundary only, not Platform/Publish/ChatGPT authority;
- **effects** — builds the real pinned `semwright-native-effects` helper, evaluates an exact Launchwright-owned immutable artifact, and rechecks the canonical result through Launchwright without granting execution authority;
- **browser** — installs Chromium on the runner and exercises the real Launchwright UI;
- **deltadesk** — executes the owned DeltaDesk A/B fixture through the exact pinned Semwright Broker + Policy + Chromium backend, requires fail-closed denial without `browser.modify` and for a forbidden origin, retains screenshot/receipt hashes and ingests them as `IMPORTED_UNVERIFIED`; the bounded CI fixture approver is not human approval and the lane does not fabricate Platform, Driver Host or canonical capture authority;
- **composition** — recaptures owned DeltaDesk A/B through the exact pinned Semwright Broker + Policy + Chromium path, hashes the retained PNG bytes, fail-closed transforms the reviewed pinned Semwright `combined_native` acceptance test, imports those exact bytes as managed Motion Canvas assets, and runs one canonical Composition + Audio AV plan through Driver Host/MLT to a retained MP4 and publication manifest. The verifier requires exact Broker→Film→Motion plan→AV plan→master lineage and keeps capture authority `IMPORTED_UNVERIFIED`, human approval false, Platform authority false, customer acceptance false and editorial state pending. R24 remains a candidate until this lane is green for the exact source SHA;
- **stress** — bounded high-volume persistence, observation and portable-restore acceptance.

Run expensive dependencies on GitHub Actions rather than the development workstation.

## Documentation

- [Install](docs/INSTALL.md)
- [Architecture and authority boundaries](docs/ARCHITECTURE.md)
- [Native SDK integration](docs/NATIVE_SDK.md)
- [Project Graph projection and impact](docs/PROJECT_GRAPH.md)
- [Canonical Effects readback custody](docs/EFFECTS.md)
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
