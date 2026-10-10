# Launchwright

**Source-linked release production built on the canonical Semwright Native SDK.**

Launchwright keeps product/build context, scenarios, claims, immutable release materials, verifier evidence, exact-candidate review, channel packages and recovery history in one application-owned workspace.

> **Developer preview.** The repository deliberately does not claim that the complete private product specification has passed acceptance. R23 proves the owned synthetic DeltaDesk A/B oracle through the exact pinned Semwright Broker + Policy + Chromium path while retaining human approval, Platform job authority, Driver Host isolation for browser capture and canonical customer-capture admission as unestablished. R24 is now accepted for exact source SHA `635bf1c4d02b44bd2da5ab357f408f78aa85388d`: the exact Broker capture bytes are consumed by SHA-256 as managed Motion Canvas assets in one canonical pinned Semwright Composition + Audio execution that continues through Driver Host/MLT, exhaustive sync and pre/post-encode audio verification to the retained final MP4/publication manifest. Application checks run `37582494806` passed on Linux, Windows and macOS and selective heavy Composition run `37582490691` passed. That PASS remains scoped to the owned synthetic fixture: capture authority is still `IMPORTED_UNVERIFIED`, while human approval, Platform execution, real-customer admission, editorial approval, external Publish and production deployment remain separate authorities. Launchwright consumes the pinned Semwright Native SDK rather than implementing a second automation/media kernel.

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
- R32 (accepted exact source SHA `cc56dd5fb34829ed308c70161c20c6ed5a1e2368`) operator-owned Git committed-metadata import: reads an exact base/head SHA and bounded changed-file inventory from an existing project without fetching, reading patch contents or executing that project, then records only imported UNKNOWN evidence through the canonical Native SDK dispatcher. No Project Graph or Host authority is inferred;
- R33 (accepted exact SHA `c01be5d99f8edc907a4ebb96acc20c8db113773b`) Git observation to human-editable Markdown outline: deterministic counts, source/evidence SHA pinning, default filename redaction, explicit disclosure consent and idempotent Native SDK deliverable creation. The draft remains UNKNOWN and cannot stand in for behavior/feature verification;
- (accepted exact source SHA `7c8862aeffeebeecef9e0a58313dc85961bbd16d`) R35 two-phase, operator-owned **existing Git project onboarding**: private SHA-bound plan followed by explicitly confirmed local Native SDK creation/reconciliation of Product, Release, Source, Target, imported UNKNOWN Evidence and editable Markdown; safe partial-failure retry, no network, no Project Graph/Platform authority;
- (accepted exact source SHA `af133e77cf064c49618d141d572afc333878ef7d`) R36 adds read-only temporary/workspace filesystem capacity preflight to doctor, distinguishing zero-space and low-space failures from Node/SDK issues and never deleting any files.
- R37 (accepted exact SHA `a4af17f3551dc1067001bf48ec86b88d7fd14e32`) operator-owned Git onboarding **in the local web UI**: select an R32 observation JSON, prepare/reload a byte-pinned R35 plan, confirm source/rights/commit approvals and create the editorial workspace through the canonical Native SDK dispatcher. Never accepts arbitrary filesystem paths from the browser or promotes imported metadata to technical PASS.
- R38 (accepted source `751f586d9c2ff4ae6facbc89d002804e9346e882`) local MCP stdio tool adapter through the official MCP SDK and Launchwright **public** Client SDK: independently read and version-edit the same workspace, inspect impacts/candidates/events, prepare durable local intents, explicitly submit or read-only recover unknown outcomes without a second app/Platform backend. Host-side ChatGPT acceptance remains external;
- claims, CopyBlocks, availability rules and ReleaseContract readiness denominators;
- immutable Markdown, safe HTML, JSON, email-draft and VTT artifacts with SHA-256-addressed bytes;
- explicit relation provenance plus an immutable, owner-admitted Semwright Project Graph projection with bounded visible-node impact, preserved UNKNOWN frontiers, exact-revision impact proposals/coalescing, conservative reuse assessment and rebuild/finalization receipts; local heuristics never promote themselves to Graph authority;
- canonical Native SDK Effects readback custody for immutable JSON/CSV artifacts: exact protected-spec/result bytes, source/runtime digests and artifact/scenario revision pins; R29 exact SHA `ac83fc358215ec629bf5d7b8abc9de699064862c` accepts PASS admission only behind the fixed Driver Host Effects provider plus exact receipt custody while keeping `execution_authority:false` and scenario mutation effects outside scope;
- exact-base document change proposals that cannot force-overwrite newer edits;
- exact candidate manifests that pin artifact bytes, target context, ReleaseContract, localization/glossary revisions, channel profiles and declared rights, with input freshness and review-race isolation;
- capture contract v2 tied to source + build + target + scenario, with Platform/native receipt correlation, readiness checks, anchor cardinality, build-drift detection, isolation/cleanup bounds, provenance classes and derived-material lineage while technical state stays UNKNOWN;
- owned DeltaDesk A/B browser laboratory exercised through the exact pinned Semwright Broker + Policy + Chromium path in a dedicated heavy CI lane; its real Broker-routed receipts and screenshot hashes are preserved as `IMPORTED_UNVERIFIED` capture records, fixture approval remains explicitly non-human, and no canonical Platform/Host authority is inferred;
- immutable verifier identity/version/digest, coverage, omissions and findings;
- waivers that annotate failures without changing verifier truth;
- versioned channel profiles, exact package generation, authenticated deterministic private ZIP bundles, and receipt/recovery state without performing the external send;
- R31 (accepted exact source SHA `5a34632d982110d093371103c0cab6073b2126e8`) operator-controlled GitHub Release **draft** transport: exact candidate/profile/tag/commit confirmations, deterministic ZIP upload plus remote download/hash revalidation, recover-first behavior and operator-observed DRAFT_CREATED custody. It never publishes the release or claims Semwright Platform Publish;
- R34 (accepted exact SHA `1e7a700e6d4ea2b9104ceb76ca0b15650a5d30d9`) hardens R31 recovery by enforcing exact GitHub draft title and full approved notes on every read/admission, not only the intent marker; remote drift fails closed without overwriting assets or inventing successful delivery;
- source-linked localization with glossary revision pins, explicit rebase, RTL/font-rights/critical-term blockers and no invented language/layout PASS;
- bounded extension descriptors, discovery, retirement, source-profile preflight and compatibility locks without executing remote extension code;
- versioned media plans with exact rational timing, source/claim pins, video/screenshot/interactive variants, per-variant reuse detection, sanitized interactive-source policy and independent technical/editorial state; historical R11 evidence preserves the separate 20-second real-capture MLT derivative, while accepted R24 exact-SHA evidence binds the exact Broker A/B PNG hashes as managed Motion Canvas assets in a single canonical Semwright AV recipe and retains the resulting MP4 plus publication lineage without promoting fixture capture into customer/Platform authority;
- bounded Publish product contracts: editable ReleaseTemplate drafts, immutable ProductVersion pins, deployment lifecycle, isolated consumer invocations, idempotent attempt keys and authority-free export/import with explicit local rebind/recheck; external activation still belongs to Platform Publish;
- private-draft alias delivery with compare-and-swap;
- portable snapshot/restore v2 that preserves exact stored revision history, rotates workspace generation/request epoch, suspends uncertain intents, and accepts older snapshots without fabricating historical revisions;
- read-only `doctor` diagnostics plus a clean-room operator rehearsal that checks the pinned Native SDK, local state safety and portable restore without inheriting author secrets or machine paths;
- application-side usage reservations and idempotent usage receipts, with measured/estimated/BYO separation, auditable corrections, explicit overrun visibility and test-only billing callbacks; these records are projections and never claim Platform billing authority;
- bounded extension runtime receipts for owner-controlled renderer/importer fixtures, with exact preparation pins, rights checks, output budgets, retirement-aware freshness and explicit UNKNOWN technical state; R20 admits the extension **control plane** through canonical Driver Host without falsely claiming the separately executed fixture processes themselves are Host-isolated or technical PASS. R28 accepts a separate path for the two repository-owned deterministic fixtures (DeltaRender and DeltaCLI status): execution occurs in a fixed Driver SDK provider under Driver Host and can become PASS only from an exact Host receipt admitted by the isolated `extension_runtime` Native profile; arbitrary or third-party extension execution remains outside that authority.
- public HTTP client, browser UI, CLI and Native Application bridge sharing the same dispatcher and SQLite transaction model.
- selective exact-SHA Driver Host acceptance that runs the real Launchwright NativeDriver through Semwright daemon/Broker/Policy, a sealed Node runtime and owner-pinned NodeBridge bundles; R20 admits the extension control plane and R21 additionally executes the owned Project Graph fixture through live Broker routes, persists the admitted bounded projection and verifies a separate `project.manage` denial control. This establishes only those owner-controlled Host paths and does not promote external Platform/Publish/ChatGPT authority.

## Semwright Native SDK

The public `@semwright/native-sdk` source is vendored unchanged under its upstream **MIT OR Apache-2.0** license. `SOURCE_LOCK.json` pins:

- Semwright source `d2da9a495a53fe279a1ca4de61f0e24646350f22` (post-v1.0.0 reviewed main; includes PR #250 Effects/Landlock fix)
- base Native SDK package/release `v1.0.0` at `8fa191250ae68274182570c65f067f7a60f85625`
- Native SDK `1.0.0`
- exact SHA-256 hashes for the redistributed SDK files/archive

R27 exact source SHA `aad7d4f744d5067b920f0befdaf4a6238a29dd65` passed Linux/Windows/macOS Application checks and heavy `lane=all` against Semwright `v1.0.0`; browser, verifier, stress, host, native, Godot, Effects, Composition and DeltaDesk all passed. Those results preserve each lane's existing authority boundary rather than extending it.

The canonical `NodeBridge` allows at most 48 KiB per owner-pinned executable bundle. Launchwright therefore maps all 86 public operations exactly once across thirteen bounded profiles (`core`, `production`, `review`, `verifier`, `integrations`, `extensions`, `extension_runtime`, `work`, `media`, `publish`, `graph`, `effects`, `effects_runtime`) instead of weakening that upstream limit. `scripts/build-native-bundle.mjs` hashes each exact bundle and rejects missing/duplicate operations or oversized output. `crates/launchwright-native` pins all thirteen hashes at build time. The caller cannot choose arbitrary executable code, mounts or runtime paths; authority-sensitive verifier, extension-runtime, graph, Effects inspection and Effects runtime admission remain separated from the general profiles.

The optional Platform adapter consumes an owner-supplied byte-pinned package. The inspected Platform source is not licensed for redistribution, so it is not copied into this public repository.

## Trust model

Launchwright keeps **production, verification, review and delivery** separate.

R30 (accepted at exact SHA `af717a760f28e56a086c53295d6c070d375c05e0`) adds a fixed credential-pattern exposure check for exact text candidate bytes using Semwright Driver Host. This is not a general privacy audit. See [scope and limits](docs/CREDENTIAL_VERIFIER.md).

A successful capture contract can establish that an authorized receipt, readiness conditions, unique anchors and provenance were recorded; it does not establish semantic correctness or Driver Host acceptance. Generated/editorial/imported material is never eligible to stand in for observed product state, and a sanitized derivative only preserves that eligibility when its exact parent capture did and every declared transformation preserves observed state. A heuristic/model/local PASS remains effective UNKNOWN unless admitted by canonical verifier authority. A waiver records an exception but never turns FAIL into PASS. A channel package says bytes are ready; it does not mean they were uploaded or published. A local ReleaseTemplate/ProductVersion/deployment contract likewise does not prove a remote consumer job ran. Public activation requires a canonical Publish receipt.

An owner-admitted Project Graph observation can project canonical snapshot/impact knowledge into Launchwright, but local input-pin comparisons, declared/imported/heuristic relations and cache hits are not Project Graph completeness or admission. The exact R21 Host acceptance at SHA `8de121fca5d81803c7781a2bca58d5344927a9cd` drove the pinned Semwright Broker through `project.create`, file-backed asset registration/reconciliation, `project.edge.declare`, `project.query`, `project.impact` and `project.manifest.export`, then recorded that bounded owner-controlled result through the real Launchwright NativeDriver `graph` profile. Semwright correctly marks the file-scoped query `scope_partial:true`; Launchwright stores `denominator_complete:false` rather than inventing completeness. The integrated Native SDK Effects reader likewise preserves its narrower authority. For media, Launchwright still does not own a clock or renderer: accepted R24 SHA `635bf1c4d02b44bd2da5ab357f408f78aa85388d` transforms only the exact reviewed Semwright AV acceptance harness, fail-closed by source SHA-256, so the retained Broker A/B bytes are imported as managed Motion Canvas assets and continue through the canonical Composition coordinator, Driver Host/MLT, exhaustive sync/audio verification and publication. `composition-single-recipe` reports fixture-scoped technical PASS only when those exact receipts and retained MP4 bytes agree; capture admission, human approval, Platform execution, real-customer acceptance and editorial state remain independent.

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

GitHub Actions runs the supported Node 24.21 runtime on Linux, Windows and macOS. The manual heavy workflow has ten independently selectable lanes:

- **native** — builds the pinned TypeScript SDK, all thirteen owner-pinned bundles and real Rust NativeDriver with Graph + Effects SDK features;
- **host** — checks out the exact pinned Semwright SHA and runs Launchwright through the real daemon → Broker/Policy → Driver Host → sealed Node runtime → owner-pinned NodeBridge bundle path, including durable mutation/readback, stale-ref invalidation across restart and a policy-denied negative control; a green exact-SHA run establishes this Host boundary only, not Platform/Publish/ChatGPT authority;
- **verifier** — builds the bounded Driver SDK format and credential-pattern verifier and routes its exact candidate/artifact-bound receipt through Broker/Policy/Driver Host into the dedicated Native `verifier` profile; it proves canonical format admission only and explicitly carries no semantic/editorial/Platform/publication authority;
- **effects** — builds the fixed Launchwright Effects Driver SDK provider and the thirteen-bundle NativeDriver, links the canonical Semwright v1 Effects reader into that provider, evaluates only an owner-staged protected spec/artifact root inside Driver Host, admits the exact Host receipt through `effects_runtime`, and proves substitution/policy/drift controls while preserving `execution_authority:false` and no scenario-mutation authority;
- **browser** — installs Chromium on the runner and exercises the real Launchwright UI;
- **deltadesk** — executes the owned DeltaDesk A/B fixture through the exact pinned Semwright Broker + Policy + Chromium backend, requires fail-closed denial without `browser.modify` and for a forbidden origin, retains screenshot/receipt hashes and ingests them as `IMPORTED_UNVERIFIED`; the bounded CI fixture approver is not human approval and the lane does not fabricate Platform, Driver Host or canonical capture authority;
- **composition** — recaptures owned DeltaDesk A/B through the exact pinned Semwright Broker + Policy + Chromium path, hashes the retained PNG bytes, fail-closed transforms the reviewed pinned Semwright `combined_native` acceptance test, imports those exact bytes as managed Motion Canvas assets, and runs one canonical Composition + Audio AV plan through Driver Host/MLT to a retained MP4 and publication manifest. The verifier requires exact Broker→Film→Motion plan→AV plan→master lineage and keeps capture authority `IMPORTED_UNVERIFIED`, human approval false, Platform authority false, customer acceptance false and editorial state pending. R24 exact source SHA `635bf1c4d02b44bd2da5ab357f408f78aa85388d` passed selective heavy run `37582490691`.
- **godot** — exercises the bounded owned Godot execution profile through the pinned Semwright Godot/Native/Host path without extending that evidence to arbitrary customer projects or Platform authority;
- **stress** — bounded high-volume persistence, observation and portable-restore acceptance.

Run expensive dependencies on GitHub Actions rather than the development workstation.

## Documentation

- [Install](docs/INSTALL.md)
- [Architecture and authority boundaries](docs/ARCHITECTURE.md)
- [Native SDK integration](docs/NATIVE_SDK.md)
- [Project Graph projection and impact](docs/PROJECT_GRAPH.md)
- [Read-only Git change sources for existing projects](docs/GIT_CHANGE_SOURCE.md)
- [Git metadata to editorial release-note outlines](docs/GIT_RELEASE_OUTLINE.md)
- [Onboard an existing Git project with a recoverable plan](docs/GIT_PROJECT_BOOTSTRAP.md)
- [Onboard an existing Git project in the local web UI](docs/GIT_ONBOARDING_UI.md)
- [R40: safely stage reviewed Markdown into an owned Git docs branch](docs/GIT_DOCS_BRANCH.md)
- [R41: operator-controlled GitHub DRAFT PR from exact approved Git docs branch](docs/GIT_DOCS_DRAFT_PR.md)
- [R42: frozen Markdown to editable PPTX and matching PDF](docs/DECK_PDF.md)
- [R48: bounded real Android emulator screenshot and Native imported evidence](docs/ANDROID_EMULATOR_CAPTURE.md)
- [R49: bounded Apple CoreSimulator iPhone screenshot with Native imported UNKNOWN receipt](docs/IOS_SIMULATOR_CAPTURE.md)
- [R43: source-pinned offline interactive demo from sanitized Media Evidence](docs/INTERACTIVE_DEMO.md)
- [R55: operator-defined exact PNG pixel masking and Native sanitized capture evidence](docs/PIXEL_REDACTION.md)
- [R44: Apple/Google store-specific private screenshot, graphic and listing packages](docs/STORE_ASSETS.md)
- [R45: offline versioned documentation site from exact frozen Markdown sources](docs/STATIC_DOCS.md)
- [R46: two exact private MP4 aspect formats plus frozen WebVTT captions](docs/VIDEO_VARIANTS.md)
- [R47: operator-approved WordPress post DRAFT through exact REST readback](docs/WORDPRESS_DRAFT.md)
- [R54: source-bound private dossier comparing two frozen releases](docs/RELEASE_CONTINUITY.md)
- R42/R43 owned synthetic Node24 Linux/Windows/macOS application CI and independent document/Chromium E2E accepted at exact source SHAs; see [R42 evidence](evidence/r42/ci-runs.json) and [R43 evidence](evidence/r43/ci-runs.json). Customer-side quality/privacy/product execution and Platform Publish remain unaccepted.
- R40 source `b69d17aafbb4badfd84d83205112244a994f02dc` and R41 source `b0016eaa23cc84cfdd9b290432ecee29cc9edae7` passed Node24 Linux/Windows/macOS; the latter tests GitHub DRAFT PR transport with a mocked remote only, not a live owner account.
- [MCP local Client SDK adapter and operator instructions](docs/MCP_LOCAL.md)
- [Canonical Effects readback custody](docs/EFFECTS.md)
- [DeltaDesk real-browser laboratory](docs/DELTADESK_LAB.md)
- [GitHub Release draft operator integration](docs/GITHUB_RELEASE_DRAFT.md)
- [Known SDK/platform gaps](docs/SDK_GAPS.md)
- [Storage and portability](docs/PORTABILITY.md)
- [Operations, metering and cost projection](docs/OPERATIONS_AND_COSTS.md)
- [Operator runbook](docs/RUNBOOK.md)
- [Requirements traceability](docs/REQUIREMENTS.md)
- [Acceptance ledger](docs/ACCEPTANCE.md)

## Editable deck + actual PDF (R42, preview scope)

R42 projects a human-editorial-approved, exact frozen Markdown artifact into
a private **editable PowerPoint (.pptx)** and an independently rendered
matching **PDF**. It does not summarize, invent product claims, publish or
promote UNKNOWN evidence. The real text-only output is deterministically
reproducible; a bounded parser rejects layouts that would clip or omit copy.
The operator can save a SHA-bound no-effects plan and explicitly export
both formats to a private directory with fail-closed recovery. The owned
synthetic E2E and visual-render acceptance are in the manual Deck/PDF
GitHub Actions lane; external branding, accessibility and customer
product quality review remain unestablished. See
[DECK_PDF](docs/DECK_PDF.md).


## R43 — Offline interactive screen-state walkthroughs

R43 can package 2–8 operator-selected **sanitized-derivative Media shots**
into a private, self-contained HTML ZIP. The user selects exact Evidence
IDs and approved PNG SHA-256 hashes; Launchwright generates a script-free,
mouse/touch/keyboard-navigable screen-state tour with strict CSP, real
pixel readback, source manifest and a Native imported/UNKNOWN media receipt.
The original project's scripts and remote services never execute.
This is a static offline screenshot journey **not** a customer product
simulator or proof of independent pixel privacy. A synthetic Browser CI
lane covers navigation and mobile layouts; see
[the R43 operator guide](docs/INTERACTIVE_DEMO.md).


## R44 — Bounded Apple/Google store asset packages (owner local only)

R44 creates real private, SHA-bound listing ZIPs for an Apple iPhone
Dynamic Island medium screenshot profile and a Google Play phone-portrait
profile. Each pack binds its Candidate, Channel Profile and source
provenance, validates PNG dimensions and alpha semantics, preserves
operator-written listing metadata and has an offline CSP-protected preview.
The pipeline never resizes artwork, invents claims or publishes.
Pixel origin, privacy/rights review, real device and store-account
acceptance remain unestablished. See [store assets](docs/STORE_ASSETS.md).


## R45 — Offline version-bound documentation site

R45 (accepted exact source SHA `68c8baf1013c4a16346c17c15d47293713144b36`) compiles two to twelve editorial-approved, exact frozen Markdown artifacts
from the same release and target into a **complete offline HTML documentation
site**. Real internal links, code examples, accessible navigation and
build/source version pins are validated; unsupported Markdown or external
resources fail closed. Its ZIP and private receipt are SHA-bound and
reproducible, can recover partial exports without overwriting edits, and
require explicit review/consent before local output. A disposable Chromium
E2E validates keyboard navigation and responsive layouts. This is **not**
customer documentation acceptance, public deployment or technical PASS.
See [the R45 docs guide](docs/STATIC_DOCS.md).


## R46 video aspect variants (source-linked, no alternate timeline)

An operator-reviewed Media 1280x720 H.264/AAC 30fps source with exact
Native Media Output digest and frozen WebVTT captions can generate a private
1280x720 master MP4 + derived 720x1280 MP4 without cropping, preserving the
source AAC and caption timing. The two-phase plan/export is SHA-bound,
idempotent and filesystem-safe; native Media records the portrait result
as imported/UNKNOWN, not canonical Composition PASS. The owned technical
FFmpeg CI validates actual MP4 frames, audio parity and screenshots. This
does NOT generate alternate voice, burn captions, publish, or accept a
customer marketing-video quality claim. See [R46 video variants](docs/VIDEO_VARIANTS.md).


## R49 local iPhone Simulator screenshot (owned fixture only)

R49 observes an **already booted, locally owned iPhone Simulator** and an
already installed, operator-approved app through narrowly scoped Apple
CoreSimulator commands. It records a real screenshot with CRC/dimension
checks, SHA-bound private output/receipt recovery and canonical Semwright
Native SDK imported evidence, technical **UNKNOWN**. The adapter never
boots/installs/launches apps or accesses physical phones. A selective macOS
GitHub Actions lane compiles an owned UIKit fixture and independently boots/
launches it before the adapter observes genuine pixels. The fixture runner
cannot certify any customer app, installed binary hash, foreground
isolation, pixel privacy, Driver Host or Platform authority. See
[IOS_SIMULATOR_CAPTURE](docs/IOS_SIMULATOR_CAPTURE.md).


## R48 Android emulator screenshot acceptance (synthetic scope)

R48 adds a **bounded ADB screenshot reader for locally approved Android
emulators**, with no arbitrary shell/app launch, no physical device, and
no new Native SDK backend. A private no-effects identity plan and separately
approved foreground capture produce a real metadata-stripped PNG, SHA receipt
and one existing Native SDK imported Evidence row. Technical state stays
UNKNOWN and customer/platform/Android Driver Host rights remain unestablished.
A selective CI Android34 owned synthetic APK/emulator runner is required
before R48 source acceptance. [Android emulator guide](docs/ANDROID_EMULATOR_CAPTURE.md).


## R52 provisional Google Play Edit images

R52 connects an operator-approved R44 PNG package to an EXISTING Google
Play Edit. It never creates or commits an Edit, deletes images, changes a
listing or publishes. Only empty image slots are supported. An exact
SHA-bound plan, private OAuth bearer file, explicit first-send consent,
remote SHA-256 readback, a local write lock and read-only recovery protect
the upload. Google Play image ordering and source pixel privacy are not
independently verified. No real Google Play account was tested.
See docs/GOOGLE_PLAY_IMAGES.md.


## Two-release historical continuity (R54)

R54 adds an operator-private, version-bound comparison of two **distinct
releases of one product**, both selected from their existing immutable Native
SDK candidates. It compares every registered deliverable/target semantic slot,
separates editorial copy SHA equality from release-bound rendered-byte changes,
and identifies added, removed or changed candidate outputs without
automatically reusing old assets. The result is a deterministic offline
HTML+JSON ZIP and byte-verifiable private receipt, with human operator
confirmations and safe interrupted-export recovery. Missing Project Graph,
source execution and external Publish evidence remain UNKNOWN. The synthetic
two-release acceptance uses real Native/SQLite state and a separate offline
Chromium lane; user/customer production coverage and actual platform
deployment remain independent. See
[Release continuity review](docs/RELEASE_CONTINUITY.md).


## Original master scope and truthful transfer acceptance

The original private Semwright Release Studio / Launchwright master specifies
**196 public-safe requirement IDs across 22 modules and 36 mandatory E2E
scenarios**. Do not misread the application's historical wave percentages as
this master's Definition of Done: the public requirements index currently
references only 21 distinct E2E scenarios, not all 36. Several CORE product
output profiles remain partial, missing or blocked by upstream Platform
interfaces. **The whole-master gate is BLOCKED**, despite the accepted
individual synthetic-fixture CI lanes. No real customer, ChatGPT Plugin-host,
cross-tenant Semwright Platform Publish or app-store account acceptance has
been claimed.

Public-safe transfer and project audit artifacts:

- [Master discovery and source locks](DISCOVERY_REPORT.md)
- [Per-profile master capability matrix](CAPABILITY_MATRIX.md)
- [Machine-readable aggregate acceptance report](ACCEPTANCE_REPORT.json)
- [Delivery status — explicitly NOT complete](DELIVERY_REPORT.json)
- [Contract ownership and responsibility](OWNERSHIP.md)
- [Mapping from SRS intentions to actual Native SDK contracts](CONTRACT_MAPPING.md)
- [Installation/operator entry](INSTALL.md)
- [Reproducible verification](VERIFY.md) and [selected-suite launcher](scripts/acceptance-launcher.mjs)
- [Migration and recovery](MIGRATION.md)
- [Incident/operator runbooks](RUNBOOKS.md)
- [Known limitations and blockers](KNOWN_LIMITS.md)
- [Versioned public-safe master profile evidence](docs/master-profiles.json)

To inspect the master gate without changing the application, run
\`node scripts/master-acceptance.mjs --check\`. The strict
\`--require-complete\` mode **fails** while the original obligations lack
evidence; this is intentional, not a test failure to waive. The GitHub
\`source-transfer.yml\` manual workflow uses Node24, runs real tests,
validates the master gate, and produces a source ZIP, SHA-256 checksum and
receipt from **one exact committed Git SHA**, excluding untracked state/
private master ZIP, not a public GitHub Release. No credential content scan
is certified by that workflow.

## License

New Launchwright code is **AGPL-3.0-only**. Canonical Semwright SDK files retain **MIT OR Apache-2.0** and their original notices.

The private source specification, credentials, private runtime state, browser profiles, product captures and unlicensed Platform source are not part of this public repository.

### Extensibility reference path

Launchwright includes a bounded extension registry/preparation contract and an executable fixtures/deltacli.mjs second-source fixture. The fixture produces a real process receipt; Launchwright deliberately keeps its technical state UNKNOWN until canonical Driver Host admission is available.
