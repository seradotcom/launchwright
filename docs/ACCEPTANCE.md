# Acceptance ledger

This ledger separates implemented behavior from execution evidence. A PASS belongs to an exact SHA, environment and lane; it is never inherited from another commit.

## Supplemental workstation checks

R22 workstation checkpoint (supplemental; exact CI Host acceptance is recorded below):

- Node 22.22.0 remains **outside** the supported Native SDK engine and therefore cannot establish supported-engine or Driver Host acceptance.
- Targeted Effects/Host regressions and the full lightweight suite passed locally; exact TAP/verification outputs are retained under `evidence/r22/`.
- `node scripts/verify.mjs` retained source-lock and Native operation checks; local `host_acceptance` remains false by design.
- The R22 `host` lane is CI-only. Exact source SHA `3a3422b2b187d4f2fa67e402093ce2960b4d579f` passed run `37563726988`, job `112606609973`, proving canonical Effects readback custody through the real daemon/Broker/Policy/Driver Host path while explicitly keeping owner admission, Effects evaluator Host isolation and execution authority false.

R21 workstation checkpoint (supplemental; exact CI Host acceptance is recorded below):

- Node 22.22.0 remains **outside** the supported Native SDK engine and therefore cannot establish supported-engine or Driver Host acceptance.
- Targeted Project Graph/Host regressions: **16 passed, 0 failed, 0 skipped**. The R21 source lock verifies that the Host harness drives the exact Semwright Broker Project Graph routes and records the bounded result through the Launchwright `graph` Native profile, while retaining a separate `project.manage` denial control and no Platform job authority.
- `npm test`: **177 passed, 0 failed, 0 skipped**. Exact TAP is retained in `evidence/r21/local-test.tap`.
- `node scripts/verify.mjs`: **97 JavaScript modules and 84 Native driver operations** checked; source lock/syntax PASS. Exact JSON is retained in `evidence/r21/verify.json`; `host_acceptance` remains false because this workstation run cannot establish the real daemon/Broker/Policy/Driver Host path under the supported engine.
- The R21 `host` lane is CI-only. Exact source SHA `8de121fca5d81803c7781a2bca58d5344927a9cd` subsequently passed that lane in run `37561836145`, proving the live Broker route, exact transcript binding, daemon-restart persistence and fail-closed denial without `project.manage`; the workstation result itself remains supplemental.

R20 pre-Host checkpoint on the workstation:

- Node 22.22.0 remains **outside** the supported Native SDK engine and therefore cannot establish supported-engine or Driver Host acceptance.
- `npm test`: **176 passed, 0 failed, 0 skipped**. The new R20 regression locks the extension lifecycle Host harness and, critically, locks the non-escalation boundary: Host-mediated extension control-plane operations do not make the separately executed DeltaRender/DeltaCLI fixture processes Host-isolated or technical PASS. Exact TAP is retained in `evidence/r20/local-test.tap`.
- `node scripts/verify.mjs`: **97 JavaScript modules and 84 Native driver operations** checked; source lock/syntax PASS. Exact JSON is retained in `evidence/r20/verify.json`; `host_acceptance` remains false because this workstation run cannot establish the real Broker/Policy/Driver Host path.
- The R20 `host` lane is CI-only. It installs/discovers the renderer and second source through the real Host route, records their bounded results, exercises compatibility negotiation and retirement/history preservation, and must retain `extension_fixture_execution_host_isolation_accepted=false` for the external fixture processes.

R19 pre-Host checkpoint on the workstation:

- Node 22.22.0 remains **outside** the supported Native SDK engine and therefore cannot establish supported-engine acceptance.
- `npm test`: **175 passed, 0 failed, 0 skipped**. The three new R19 source regressions lock the exact Semwright SHA, real Host/sandbox requirements and the non-escalation of Driver Host evidence into external Platform authority. Exact TAP is retained in `evidence/r19/local-test.tap`.
- `node scripts/verify.mjs`: **97 JavaScript modules and 84 Native driver operations** checked; source lock/syntax PASS. Exact output is retained in `evidence/r19/verify.json`, and `host_acceptance` intentionally remains false because workstation/direct-process evidence cannot establish Driver Host isolation.
- The R19 `host` lane itself is CI-only. Its status belongs to the exact pushed SHA and is recorded only after the real daemon/Broker/Policy/Driver Host route completes.

Supplemental workstation pass for the current R12 Effects-readback branch:

- Node: 22.22.0 — **outside** the Native SDK supported engine.
- `npm test`: **172 passed, 0 failed, 0 skipped**. Exact TAP output is retained in `evidence/r12/local-test.tap`; this local run is supplemental because Node 22.22.0 is outside the supported engine. R12 adds four fail-closed RS-EFX regressions for non-admitted PASS, explicit owner admission, revision/input drift invalidation, canonical FAIL preservation, digest scope and admission denial.
- `node scripts/verify.mjs`: source-lock integrity and syntax PASS; **96 JavaScript modules and 84 Native driver operations** checked. Exact output is retained in `evidence/r12/verify.json`. `host_acceptance` remains false.
- R9 supplemental Native profile build (source SHA `554e153458d734aea92fb2c56aa6d461324051cd`): **82/82 public operations assigned exactly once** across nine compacted canonical bridge bundles. Exact local sizes are core **46,007**, production **42,528**, review **47,219**, integrations **34,179**, extensions **42,597**, work **42,156**, media **39,969**, publish **48,469**, graph **48,166** bytes. Graph authority-sensitive operations were moved out of general production rather than weakening the canonical 48 KiB limit; `publish` is tightest with 683 bytes of headroom and `graph` has 986 bytes. Exact manifest and build log are retained in `evidence/r9/native-bundle.json` and `evidence/r9/native-bundle-build.log`.
- R9 supplemental multi-profile canonical bridge smoke: **PASS** for all nine profiles (`core`, `production`, `review`, `integrations`, `extensions`, `work`, `media`, `publish`, `graph`); exact bundle SHA-256 and byte counts were rechecked before execution and every invocation stayed within the canonical input budget. Output is retained in `evidence/r9/bundle-smoke.json`. This direct-process workstation smoke is not Driver Host isolation acceptance; the exact R9 GitHub `native` lane subsequently passed and is recorded below.
- Clean CLI drill: init → synthetic demo → portable snapshot → restore to a new state directory → doctor PASS.
- Clean-room operator rehearsal launches those commands in fresh temporary state with only a minimal inherited environment, verifies Native SDK pin integrity, rejects exported session-token/machine-path leakage, and proves the restored workspace rotates generation without reactivating old mutation receipts. Current supplemental output is retained in `evidence/r9/clean-room.json`; GitHub CI repeats this on Linux, Windows and macOS and uploads the exact report per SHA.
- Restore drill confirmed a new workspace generation, advanced request epoch and no activation of historical mutation receipts.
- Independent `unzip -t` validation of a generated private bundle: **PASS**; exact channel manifest, candidate manifest, artifact bytes and review notice were all readable.
- Git diff whitespace gate: PASS.
- Executable DeltaCLI reference source: real process execution and bounded receipt ingestion PASS, including build-drift rejection, secret-bearing flag rejection, exact adapter pinning and retirement detection; technical state intentionally remains UNKNOWN without Driver Host admission.
- Executable DeltaRender extension fixture: bounded owner-controlled renderer output is recorded through an exact preparation/result contract; output-type substitution and package-budget overflow are rejected, and retirement preserves history while blocking new starts.
- Mobile-import fixture: bounded Android/iOS bundle normalization is import-only, records content hashes/provenance, and explicitly reports `device_execution_observed=false` and `IMPORTED_UNVERIFIED` instead of fabricating native capture.
- R7 local consumer rehearsal: a separate Node process that imports only the public client invokes a pinned ProductVersion through loopback HTTP under a `consume`-only identity; owner workspace reads, owner-session login and cross-consumer invocation inspection are rejected. Template edits leave the frozen ProductVersion digest unchanged, deprecation is observable, retirement blocks new invocations, and earlier invocation history remains readable by its own consumer.
- Prepared HTTP v2 envelopes are bound to the authenticated principal before mutation. Another consumer cannot submit that envelope, and durable recovery returns a stored result only to the principal that originally committed it.

These checks are useful regression evidence only. They are not supported-engine, Driver Host, browser-product-capture or external-channel acceptance. The local `RS-PUB-01..08` regressions plus the separate-process rehearsal establish application-side contract and identity isolation only; the source acceptance scenario still requires a real Platform Publish ProductVersion/deployment, canonical cross-tenant identity/entitlements, metered job execution and output ACL enforcement.

## Supported-engine GitHub acceptance

The repository requires Node 24.21.x. The current branch must pass `Application checks` on Linux, Windows and macOS after its commit is pushed.

Historical R8A evidence for exact source SHA `45f05b959e74dc6861bcdc3b5645014d64ceb4ad`: Application checks run `37432440809` passed on Linux, Windows and macOS; Native/Rust run `37432464643` passed; bounded stress run `37432467712` passed. PR #27 was merged only after those lanes completed. Historical R8B evidence was also green before merge: application checks run `37435456892` passed on Linux, Windows and macOS, with heavy runs `37435493927` and `37435497258` succeeding for the exact R8B source SHA.

R9 exact-SHA acceptance is complete for `554e153458d734aea92fb2c56aa6d461324051cd`: Application checks run `37517585926` passed on Linux, Windows and macOS; selective heavy Native run `37517606605` passed; selective heavy Stress run `37517610676` passed. PR #29 was merged to `main` as `efdd2d31df50ee555585d1b3fd7b3e3866e6ffc1`. These results are exact to R9 and are not inherited by later passes.

R11 exact-SHA acceptance is complete for `71f9c89604a2b244cac12661db3a09493ff7f7d9`: Application checks run `37527185849` passed on Linux, Windows and macOS, and selective heavy Composition run `37527194362` passed the real DeltaDesk capture → even-canvas derivative → Semwright MLT Driver Host MP4 leg plus the independent canonical Composition + Audio AV E2E at the same pinned Semwright SHA. PR #31 was merged to `main` as `8c7d57ac2a90ac003c048bb99da05b430f21b2e3`. Those PASS results belong to R11 only; R12 must earn its own supported-engine and Native/Effects evidence.

R19 Driver Host acceptance is complete for exact source SHA `84618c0d9700ebb0d4e2a774bf02418bbe79ea23`: Application checks run `37545788650` passed on Linux, Windows and macOS, and selective heavy Host run `37545791165` passed job `112549363177`. Artifact `11450612093` records `driver_host_isolation_accepted=true`, `broker_policy_path_observed=true` and `host_mediated_node_runtime=true` against Semwright `4d291de26724810017ce7b6d185326514cb79fa6`; it also proves durable mutation/readback across Host restart, revocation of the old opaque ref, rejection of an invalid request digest without revision advance, and fail-closed denial when `driver:launchwright` is removed from policy. The same report explicitly keeps external Platform, ChatGPT-host and public-channel acceptance false. This PASS belongs to `84618c0…` only; later source revisions must run the Host lane again.

R20 extension-control-plane acceptance is complete for exact source SHA `c1ca6121e40f2c2fbec3778b96a03c790c5dc252`: Application checks run `37549087851` passed on Linux, Windows and macOS, and selective heavy Host run `37549091108` passed job `112560036046`. Artifact `11452516059` records schema `launchwright-native-host-acceptance/2` against Semwright `4d291de26724810017ce7b6d185326514cb79fa6`, with `extension_control_plane_driver_host_accepted=true` while deliberately retaining `extension_fixture_execution_host_isolation_accepted=false`. The Host path installed/discovered owned DeltaRender and DeltaCLI descriptors, prepared and recorded the renderer result, recorded the second non-DOM CLI source, rejected unsupported-major negotiation, observed compatibility-lock drift after retirement, preserved renderer/CLI history, and retained `technical_state_promoted=false`. This proves the Launchwright extension control plane through daemon/Broker/Policy/NativeDriver/Driver Host; it does **not** claim the separately executed fixture processes themselves ran inside Driver Host. This PASS belongs only to `c1ca612…`.

R21 Project Graph Host acceptance is complete for exact source SHA `8de121fca5d81803c7781a2bca58d5344927a9cd`: Application checks run `37561839893` passed on Linux, Windows and macOS, and selective heavy Host run `37561836145` passed job `112600625256`. Artifact `11457174433` records schema `launchwright-native-host-acceptance/3` against Semwright `4d291de26724810017ce7b6d185326514cb79fa6`, with `project_graph_live_broker_admitted=true`, `project_graph_native_projection_recorded=true` and `project_graph_platform_job_authority=false`. The Host path created the owned Project, reconciled file-backed assets, declared the edge, executed bounded query/impact/manifest export, bound transcript SHA-256 `31c5e785014d304016da627713ccc156c54562060f83fc0d286e04d8c5da2066` into the durable projection, survived daemon restart and separately rejected Project mutation without `project.manage`. Semwright's file-scoped query remains `scope_partial:true`; Launchwright preserves that uncertainty with `denominator_complete:false`. This proves only the owned R21 Broker/Native/Host path, not Platform scheduling or real customer/project extraction. This PASS belongs only to `8de121f…`.

R22 Effects Host-custody acceptance is complete for exact source SHA `3a3422b2b187d4f2fa67e402093ce2960b4d579f`: Application checks run `37563728450` passed on Linux, Windows and macOS, and selective heavy Host run `37563726988` passed job `112606609973`. Artifact `11458422032` records schema `launchwright-native-host-acceptance/4` against Semwright `4d291de26724810017ce7b6d185326514cb79fa6`, with `effects_canonical_readback_host_custody_accepted=true` while deliberately retaining `effects_owner_admission_accepted=false`, `effects_evaluation_driver_host_isolation_accepted=false` and `effects_execution_authority=false`. The Host path created an exact Launchwright-owned artifact binding, carried the protected Native SDK Effects spec/result digests through the real Launchwright NativeDriver, preserved the canonical reader PASS as effective Launchwright `UNKNOWN`, rejected owner admission that this path cannot justify, and retained the earlier extension/Project Graph Host controls. This proves custody and exact readback binding through Host, not mutation/noninterference evaluation or scenario-effect execution. This PASS belongs only to `3a3422b…`.

R23 Broker-routed DeltaDesk browser acceptance is complete for exact source SHA `ce92ffbd3402b8a374fa664f3da65b63c1d69193`: Application checks run `37569449701` passed on Linux, Windows and macOS, and selective heavy DeltaDesk run `37569447808` passed job `112624530363`. Artifact `11459528622` records schema `launchwright-deltadesk-browser-broker/1` against Semwright `4d291de26724810017ce7b6d185326514cb79fa6`. The exact pinned Semwright Broker + Policy + Chromium path completed both A/B semantic oracles, retained screenshot SHA-256 values `a291c60f541b3d65c4ec112e7b39ed6e7dfc16327a69afe963c61b0b2875e8d4` and `3e194a882d5e5ba11110c82e406dd4a5da2d686065142a77a20700659b039fac`, verified cleanup of Semwright-owned screenshot artifacts, denied `browser.launch` without `browser.modify`, and denied a forbidden origin. Sensitive `browser.launch`/`browser.screenshot` approval came only from a bounded CI fixture approver. The ingestion report therefore keeps both captures `IMPORTED_UNVERIFIED`, technical `UNKNOWN`, `host_acceptance=NOT_ESTABLISHED` and `observed_state_eligible=false`; human/operator approval, Platform job authority, Driver Host isolation and canonical capture admission remain false/unestablished. This PASS belongs only to `ce92ffb…`.

R24 single-recipe Composition acceptance is complete for exact source SHA `635bf1c4d02b44bd2da5ab357f408f78aa85388d`: Application checks run `37582494806` passed on Linux, Windows and macOS, and selective heavy Composition run `37582490691` passed job `112665108328`. Artifact `11465088955` records schema `launchwright-composition-single-recipe-evidence/1` against Semwright `4d291de26724810017ce7b6d185326514cb79fa6`, preserving Broker capture SHA-256 values `a291c60f541b3d65c4ec112e7b39ed6e7dfc16327a69afe963c61b0b2875e8d4` and `3e194a882d5e5ba11110c82e406dd4a5da2d686065142a77a20700659b039fac`, then consuming those exact bytes in one canonical Composition/Audio plan through Driver Host/MLT. Exhaustive sync plus pre/post-encode audio verification passed, the retained master MP4 SHA-256 is `982af5ddd48948c92444a1a18c7150efbcc501c7531ada087c9d69d7ec99ccb4`, and the final chain digest is `bef7ace7a7f5ed9f17c5756effe3e75c4e23e5409f442407a773d9a7d8ff0dcc`. The receipt's `technical_state=PASS` and `media_requirement_state=PASS` are scoped to `OWNED_SYNTHETIC_DELTADESK_EXACT_SHA`; capture authority remains `IMPORTED_UNVERIFIED`, human/operator approval false, Platform execution authority false, external-customer acceptance false and editorial state pending. This PASS belongs only to `635bf1c…`.

R25 Godot Native/Host acceptance is complete for exact source SHA `6c41a0b1187057f72d4e4ecdf2cd3c5c8be478fb`: Application checks run `37584867199` passed on Linux, Windows and macOS; selective heavy Godot run `37584900091` passed job `112672695523`, selective heavy Native run `37584904179` passed job `112672708081`, and selective heavy Host run `37584907427` passed job `112672717847`. Artifacts `11465949348`, `11466302682` and `11467370638` preserve the exact Godot-profile, NativeDriver and Host evidence for that SHA. PR #39 was merged to `main` as `97ee2ec127b763571da612056a93e9d7d93e1c09`. This closes only the bounded owned Godot execution profile exercised by those lanes; real-customer Godot projects, arbitrary-project mutation/effect/noninterference, mobile execution, Platform authority and external-customer acceptance remain outside R25.

R26 verifier-runtime acceptance is complete for exact source SHA `4b0a437ef2fbd67d199dcf33e0d0d405ef91e0ad`: Application checks run `37702867268` passed on Linux, Windows and macOS; selective Native run `37702865584` passed with artifact `11518232674`; selective Verifier run `37702863007` passed with artifact `11519045202`; and selective Host run `37702869177` passed with artifact `11519066904`. The verifier receipt records `canonical_verifier_runtime_admitted=true`, Broker/Policy and Driver Host custody, plus artifact- and candidate-substitution rejection while keeping Platform execution, external-customer, semantic, editorial and publication authority false. The Host receipt preserves Driver Host/Broker/Host-mediated Node acceptance while keeping Platform, ChatGPT-host and public-channel acceptance false. PR #40 was merged to `main` as `4a6350cf8a14fc7be8f7ee3fae235f8163f78618`. This PASS belongs only to the accepted R26 source SHA and the Semwright/Native SDK prerelease pin it exercised.

R27 Semwright v1.0.0 migration acceptance is complete for exact source SHA `aad7d4f744d5067b920f0befdaf4a6238a29dd65`. Application checks run `37707563112` passed on Linux, Windows and macOS. Heavy run `37707577491` executed `lane=all` against the published Semwright `v1.0.0` / Native SDK `1.0.0` pin and all nine lanes passed: browser, verifier, stress, host, native, Godot, Effects, Composition and DeltaDesk. The retained GitHub artifacts are browser `11519379333`, Composition `11520104842`, Effects `11520134017`, DeltaDesk `11520162660`, Godot `11520174065`, Verifier `11520174551`, Native `11520218959`, Stress `11520665738` and Host `11520892353`. PR #41 merged as `ae352f041e7fa0f253df449e4a314b9dccfb73bf`, whose push Application checks run `37709905534` also passed on all three supported runner OSes. This fresh evidence revalidates the existing bounded R23–R26 acceptance scopes against Semwright v1.0.0; it does not manufacture Platform execution, real-customer admission, remote tenant/team authority, human/editorial approval, billing or external publication authority. Exact run/job/artifact identities are retained in `evidence/r27/ci-runs.json`.

R28 bounded extension-runtime acceptance is complete for exact source SHA `1a6b2313e3abcad317c0796fb89a57fd69c5e530`. Application checks run `37715709634` passed on Linux, Windows and macOS. Selective Verifier `37715717023`, Host `37715714456`, Native `37715711554` and Extension `37715708271` runs all passed. Final heavy `lane=all` run `37720793885` then passed all ten jobs: browser, native, host, verifier, extension, Effects, Godot, DeltaDesk, Composition and stress. Its retained artifacts are Composition `11526375862`, Effects `11526365287`, Stress `11526355251`, Native `11526270802`, Browser `11526165931`, Extension runtime `11526082494`, DeltaDesk `11526070688`, Godot `11525886041`, Host `11525802977` and Verifier `11525787586`. The Extension receipt proves only the fixed repository-owned DeltaRender transform and DeltaCLI status execution through Broker/Policy/Driver Host plus exact Native receipt admission and digest/build/cross-command rejection; arbitrary/third-party extension execution, mobile-device authority, Platform/customer authority and publication remain false. PR #43 merged as `29eaa4c439993a3d6830b5893fcd5eb594c815bd`.

The manual heavy workflow provides independent lanes:

- **native**: build the pinned canonical TypeScript SDK, generate/hash all thirteen bounded bridge profiles, compile/test the real Rust NativeDriver including Project Graph and Effects SDK feature locks, and run a bridge smoke against each exercised read profile while retaining every bundle digest in the manifest.
- **host**: check out the exact pinned Semwright source and exercise Launchwright through the real daemon/Broker/Policy/Driver Host with its sealed Node runtimes and thirteen owner-pinned NodeBridge bundles. The lane requires durable mutation/readback, stale native-ref rejection across Host restart, exact request-digest rejection without state change, provider provenance and explicit negative controls. It preserves the R20 extension lifecycle and, in R21, additionally executes Semwright's real Broker Project Graph on an owned file-backed root (`project.create`, asset register/reconcile, declared edge, bounded query/impact and manifest export), binds the exact transcript digest into the Launchwright `graph` Native profile, verifies restart persistence, and separately rejects Project Graph mutation when `project.manage` is absent. Only an exact-SHA green run may establish these owner-controlled Host paths; separately executed extension fixture processes remain outside Host isolation and technical PASS, Project Graph generic-file dependency coverage remains unknown, and the lane does not establish Platform job, Publish or ChatGPT-host authority.
- **verifier**: build the exact pinned Semwright daemon/CLI/sandbox plus Launchwright NativeDriver and the separate Driver SDK verifier; require official `driver validate`/`driver conformance`; execute an owned frozen candidate through Broker/Policy/Driver Host; write only the resulting exact Host receipt into the separate read-only Native `verifier` grant; admit the candidate-wide `format` result; and prove fail-closed policy, artifact-byte substitution and receipt/candidate substitution. This lane cannot establish semantic/editorial/customer/Platform/publication authority.
- **extension**: build the fixed Launchwright extension Driver SDK provider and the thirteen-bundle NativeDriver, execute only DeltaRender and DeltaCLI status through Broker/Policy/Driver Host with a sealed Node runtime, admit exact receipts through the isolated Native `extension_runtime` profile, and require digest/build/cross-command/policy negative controls. A PASS is scoped to those two owned fixtures only; arbitrary or third-party extension authority remains false.
- **effects**: build the fixed Launchwright Effects Driver SDK provider and thirteen-bundle NativeDriver, link the canonical Semwright v1 immutable-artifact reader into the provider, execute an owner-staged protected spec/artifact root through Broker/Policy/Driver Host, admit only the exact receipt through `effects_runtime`, and require spec/result/runtime/policy/drift negative controls. This remains narrower than mutation/noninterference or scenario-effects authority and always keeps `execution_authority:false`.
- **browser**: install Chromium on a disposable GitHub runner and exercise the real Launchwright UI.
- **deltadesk**: check out the exact pinned Semwright source, run its real Broker + Policy + Chromium backend against the owned DeltaDesk A/B fixture, require fail-closed denial without `browser.modify` and for a forbidden origin, retain exact screenshots/receipt hashes, and ingest those results into `launchwright-capture/2` as `IMPORTED_UNVERIFIED`. The bounded sensitive-action approver is CI-fixture-only; no human approval, Platform job, Driver Host or canonical capture authority is fabricated.
- **composition**: recapture owned DeltaDesk A/B through the exact pinned Broker + Policy + Chromium path; bind the resulting PNG SHA-256 values to managed Motion Canvas assets; fail closed if the reviewed upstream Semwright AV test bytes drift; run the resulting Film through one canonical Composition + Audio AV plan, Driver Host/MLT, exhaustive sync and pre/post-encode audio verification; retain the final MP4/publication manifest; and verify exact Broker-to-master lineage. R24 exact SHA `635bf1c4d02b44bd2da5ab357f408f78aa85388d` passed this lane in run `37582490691`. The lane establishes only the owned synthetic technical recipe and never promotes capture admission, human approval, Platform execution, real-customer acceptance or editorial approval.
- **stress**: create a bounded high-volume workspace, page observations, export a portable snapshot, restore it and verify row continuity.

Exact run IDs and SHA are recorded here only after completion.

## Behavior covered by the current local suite

Durable identity/revisions; exact archived entity history with get/list/diff; explicit schema-v1 to v2 migration that stores current state only and labels earlier history NOT_RECONSTRUCTED; snapshot-v2 history preservation plus safe v1 restore; stale CAS; request-digest idempotency and conflict; lost-reply recovery; cursor snapshot binding; source authorization; build/target separation; claims and ReleaseContracts; safe text/VTT output; immutable artifacts/candidates; candidate-v2 pins for target context, ReleaseContract, localization/glossary, channel profile and declared rights; review-race isolation and distinct-reviewer quorum; explicit partial-package policy; LTS pinning; relation provenance; owner-admitted Project Graph projection validation, visible-resource impact privacy, canonical knowledge/UNKNOWN preservation, bounded cycle-report custody, exact observed-edge backing, cache identity invalidation, exact-revision impact proposal/coalescing and rebuild/finalization receipts; canonical Native SDK immutable-artifact Effects result custody with exact spec/result bytes and digests, exact artifact/scenario revision pins, receipt-backed Driver Host PASS admission, canonical FAIL preservation and drift invalidation while retaining `execution_authority:false`/`scenario_effects_covered:false`; immutable document change proposals with exact-base stale protection and explicit human-content acknowledgement; Platform-intent custody; application-side usage reservations, duplicate-event suppression, measured/estimated/BYO separation, measured correction chains, cost/runtime overrun visibility, Platform/native/artifact correlation and test-only billing callbacks without billing authority; Native SDK bridge; HTTP/client security; capture-contract v2 provenance with Platform/native correlation, readiness, unique-anchor cardinality, build-drift rejection, demo labeling, derivative lineage, scoped isolation, owned-resource cleanup, ordered segments and no-fake-UI eligibility; verifier authority and waivers; channel package/receipt state; deterministic authenticated private ZIP bundles with exact manifests/artifact bytes; versioned media plans with rational timing, source/claim revision pins, sanitized interactive-source constraints, three independent output classes, per-variant reuse detection, Composition handoff receipts and editorial decisions bound to exact output hashes; ReleaseTemplate/ProductVersion/deployment lifecycle with bounded consumer invocation, idempotent attempt keys, per-consumer inspection isolation, exact Platform-work bindings and authority-free export/import rebind; portable snapshot/restore.

R29 Effects-runtime acceptance is complete for exact source SHA `ac83fc358215ec629bf5d7b8abc9de699064862c`. Application checks run `37725666770` passed on Linux, Windows and macOS. Selective Effects run `37725663304`, Native run `37725665684`, Host run `37725667936` and Verifier run `37725670048` all passed. Final heavy run `37727269373` then executed all ten current lanes on that same SHA—Effects, Native, Extension, Stress, Host, Composition, DeltaDesk, Verifier, Godot and Browser—and every lane passed. Effects artifact `11527709701` records `effects_provider_driver_host_isolation_accepted=true`, `effects_evaluation_driver_host_isolation_accepted=true`, `effects_owner_admission_accepted=true`, exact spec/result and runtime/provider binding, plus policy denial without provider authority; it keeps `execution_authority=false`, scenario-effects authority false, native/browser/Godot mutation-effect authority false, Platform/customer authority false and publication authority false. The accepted flow proves wrong-spec, result-substitution, runtime-digest and external-authority controls and turns the prior PASS to `UNKNOWN` after input drift. PR #44 merged as `2146f519c2b10e3682abe41cd2e3d6b8e14c9b48`. This acceptance uses Semwright source `d2da9a495a53fe279a1ca4de61f0e24646350f22`, a reviewed post-v1.0.0 main revision required for Host-compatible Effects traversal, while the vendored Native SDK package remains version `1.0.0`. Exact run/job/artifact identities are retained in `evidence/r29/ci-runs.json`.

R30 bounded credential-pattern verifier acceptance is complete for exact source SHA `af717a760f28e56a086c53295d6c070d375c05e0`. Application checks run `37801793658` passed on Linux, Windows and macOS; selective Verifier `37801783570` (artifact `11562005067`), Native `37801787399` (artifact `11561417027`) and Host `37801791732` (artifact `11563355060`) all passed. Final heavy `lane=all` run `37825149878` passed all ten jobs: Verifier, Native, Host, Effects, Extension, Godot, Browser, DeltaDesk, Composition and Stress. The retained R30 Verifier receipt records `canonical_verifier_runtime_admitted=true`, `credential_pattern_scan_admitted=true`, `broker_policy_path_observed=true`, `driver_host_isolation_accepted=true`, `secret_pattern_negative_control=true`, `secret_finding_redacted=true` and `cross_dimension_rejected=true`, while `general_privacy_authority=false`, Platform execution and external-customer acceptance remain false. It admits a *separate* `credential-exposure` PASS bound to an exact frozen text candidate, not a broad privacy/PII certificate, a scan of opaque media or publication authority. The provider stays pinned to Semwright source `d2da9a495a53fe279a1ca4de61f0e24646350f22` with vendored Native SDK `1.0.0`. PR #46 merged as `bf19d35ab96d0f4391ab97e90fe6143e9d693b45`, whose main-push Application checks run `37827771759` also passed Linux, Windows and macOS. Full exact job and artifact metadata are retained in `evidence/r30/ci-runs.json`.

## R31 accepted — owner GitHub Release draft transport

R31 implementation acceptance is complete at exact source SHA `5a34632d982110d093371103c0cab6073b2126e8`. The Node 24 Application checks run `37834669900` passed on Linux, Windows and macOS; Native `37834721338` and full Broker/Policy/Driver Host `37834725299` passed on the same SHA. PR #48 merged as `513b27e109cf5e1c72abdd422cb9976c3ada31ed`, and main-push checks `37836252583` passed on all three OSes. The local GitHub adapter requires a saved digest-bound operator intent, existing pinned tag/commit, approved exact candidate and review, remote asset ZIP SHA-256 download verification, recover-first semantics and no automatic publishing, tag creation or clobber. Its GitHub API tests use a deterministic mock, so **live remote release creation, GitHub account acceptance and public publication remain unestablished**. Native/Host regressions exercise existing pinned Semwright paths, not canonical Platform Publish. Complete job/artifact identifiers and scope are retained in `evidence/r31/ci-runs.json`.

## R32 accepted — read-only Git project change source

R32 implementation acceptance is complete at exact source SHA `cc56dd5fb34829ed308c70161c20c6ed5a1e2368`. Native SDK integration and disposable local real Git fixture tests pass on supported Node 24 Linux, Windows and macOS in runs `37836538487` and `37836544605`. The initial source SHA `8630bf541d388eb1736776e846770eb71712eb56` failed on Windows because Git path normalization differed from Node's filesystem path, and this was corrected before acceptance. PR #49 merged as `a0c846fb21b7d55a30ad5fc05e9a8c324bad3222`, with main-push three-OS checks `37836921050` passing. The adapter observes pinned base/head commit and tree SHAs, bounded changed filename/status inventory and commit counts **without executing the repository, fetching remotes or reading code/patches/commit messages**. Its operator-approved Native SDK evidence import remains `technical: UNKNOWN` and imported-declaration only, not Project Graph, Driver Host, Platform or customer-production authority. Complete SHA/job/artefact evidence: `evidence/r32/ci-runs.json`.

## R33 accepted — Git evidence to editorial release outline

R33 is accepted at exact source SHA `c01be5d99f8edc907a4ebb96acc20c8db113773b`.
Supported Node 24 Application checks run `37840690916` completed
successfully on Linux, Windows and macOS. PR #51 merged as
`a08232b6a80d29c2fa90791816ddcd61990644a4`, whose main-push
checks `37840935212` also passed all three operating systems.
The real Launchwright Native SDK/SQLite application stores editable Markdown
drafts from R32 imported Git observations, with exact observation digest and
approved source/evidence/target/release/build bindings. By default filenames
are redacted; opt-in inclusion requires operator disclosure acknowledgement.
Human edits are not overwritten by repeats, and technical state remains
UNKNOWN. Git filenames and commit counts are never promoted into product
feature, behavior, customer acceptance, Driver Host, Project Graph or Platform
Publish authority. Exact run, job and artifact identities are recorded in
`evidence/r33/ci-runs.json`. This acceptance does not test a live customer
repository or claim actual public release.

## R34 accepted — remote draft content reconciliation

R34 is accepted at exact source SHA `1e7a700e6d4ea2b9104ceb76ca0b15650a5d30d9` with supported Node 24
Application checks `37841533294` passing Linux, Windows and macOS.
PR #52 merged as `1dd4903c45548f3aac14c7c0a02178f3a71d54ab`; main-push checks `37841858225`
passed all three OSes. The adapter no longer admits a GitHub Release
draft merely because its embedded Launchwright intent marker matches:
the remote draft name/title and complete approved Markdown body must
match the saved immutable intent (only CRLF versus LF normalization
is accepted). Changed title/notes on recovery or during upload fail
without creating a local DRAFT_CREATED success or clobbering an asset.
The exact Native SDK dispatcher has no new operations. GitHub transport
effects were validated with injected mocks, not a real external
GitHub release, publication or Platform Publish deployment. Complete
job/artifact identities and authority limits remain in
`evidence/r34/ci-runs.json`.

## R35 accepted — recoverable existing Git project onboarding

R35 is accepted at source SHA `7c8862aeffeebeecef9e0a58313dc85961bbd16d` on Node24 Linux/Windows/macOS
Application checks run `37855188445` and exact-SHA Native lane
`37855203030`. PR #54 merged as `a886c80590fa58d10b4283606e414a470686f54f`;
main-push checks `37855651604` also passed all three OSes.
The explicit private prepare/apply workflow reconciles six local resources
via the existing Semwright Native SDK dispatcher, rejects incompatible
revisions, recovers an injected mid-flow crash without duplicated records
and requires explicit source/rights/import/editorial consent and an operator
lock. Imported Git evidence remains technically UNKNOWN; no source scripts
are executed and no Project Graph, Driver Host extension, Platform,
customer or publication authority is inferred. Exact CI job and artifact
identities are retained in `evidence/r35/ci-runs.json`.

## R36 accepted — read-only filesystem capacity preflight

R36 is accepted at exact source SHA `af133e77cf064c49618d141d572afc333878ef7d` after Node 24
Linux/Windows/macOS Application checks run `37855899556`
passed, and PR #55 merged as `1b2456056965de624abcff762d0bfbe72a58ab89`. The corresponding
main-push run `37856094190` also passed all three OSes.
The local doctor now reports process-temporary and workspace
filesystem free space separately, with EXHAUSTED below 16 MiB,
LOW below 256 MiB and UNKNOWN when the capacity probe is
unavailable. Injected capacity tests prove no incorrect OK from
zero/invalid/unsupported statfs results and no file mutation.
An actual supplemental Node 22 diagnosis showed root /tmp exhausted
and the workspace filesystem with available space; selecting a
private TMPDIR on /home resolved the temporary-space warning without
deleting unrelated user files. Native Host/Platform/customer authority
is unchanged. Exact CI job/artifact receipts are retained in
`evidence/r36/ci-runs.json`.

## R37 accepted — owner-authenticated browser onboarding of Git projects

R37 passed at exact source SHA `a4af17f3551dc1067001bf48ec86b88d7fd14e32`. Node 24 Application checks
run `37868576966` succeeded on Linux, Windows and macOS.
The selective real Chromium Browser run `37868573105` passed
an owner workflow from disposable real Git commits through an R32
private JSON picker, digest-bound R35 plan, typed plan/head SHA
confirmation and four operator approvals, into six Native SDK-backed
local resources. The report records zero page errors and failed network
requests, private Git filenames not rendered, and successful viewport
overflow checks at 320, 390 and 768 px. Earlier Browser attempts
`37868099888` and `37868437463` did fail on 768 px
responsiveness; the latter revealed a long shared topbar breadcrumb
overflow that was corrected before acceptance. PR #57 merged as
`c61d0645dde4532807a0fa6c84b5ed991516c13f`, and the resulting main-push three-OS Application
checks `37868842267` succeeded. The local HTTP API is restricted
to an authenticated owner and shares the CLI lock; it does not grant
customer/tenant, Semwright Driver Host, Graph, Platform or public
publication authority. Imported evidence is technical UNKNOWN.
Exact source, run, job, artifact IDs and scope boundaries are
recorded in `evidence/r37/ci-runs.json`.

## R38 accepted — official local MCP stdio Client SDK consumer

Exact source SHA `751f586d9c2ff4ae6facbc89d002804e9346e882` passed supported Node24
Linux/Windows/macOS Application checks run `37870767220`.
PR #59 merged as `f8f391f0c17ce9c4333e7fd9613003dce61a0e3a`, whose main-push run
`37871177610` passed on all three OSes. A real separate
MCP SDK process used only the public Launchwright HTTP Client SDK
to read and edit the same local Release and Claim as an independent
HTTP client, with private 0600 token/journal, exact two-phase mutation
confirmation and read-only unknown-ACK recovery. MCP SDK v1.29.0 was
rejected by npm audit (high advisory); pinned 1.32.1 passed
production audit with zero known advisories. Local acceptance does
not establish ChatGPT Plugin host, external OAuth/tenant, Semwright
Platform Publish or customer execution authority. Exact job/receipt
data are in `evidence/r38/ci-runs.json`.

## R39 accepted — original master audit and exact Git source ZIP

The original master gate remains `BLOCKED`: 196 public-safe
requirement IDs in 22 modules and 36 mandatory E2E slots, only 21
of which are referenced by the public requirements index. The
R39 source SHA `eea822890820d114199f08f4d7356f4698956173`
passed Node24 Linux/Windows/macOS run `37872286075`;
PR #60 merged as `19a58cebd1cbcb6b4f1647438036a17d87179b8b`
and main-push run `37874241906` passed all three OSes.
The independently requested source-transfer workflow run
`37874243728` passed on this exact merge SHA,
retaining source-only ZIP
`launchwright-source-19a58cebd1cb.zip`
with independently checked SHA-256
`d8c44541444468cd9f6325a0c150efd6108cb3aafdfc3adf4c9517433c2168d3`,
800,505 bytes and 290 Git tracked records. The public committed
archive includes the machine-readable BLOCKED report, preserves
license notices and excludes untracked source credentials/caches.
No content-level secret scan, customer/Platform acceptance or
public GitHub Release is claimed. See `evidence/r39/ci-runs.json`.

## R40 accepted — reviewed Markdown to real local Git docs branch

R40 exact source SHA `b69d17aafbb4badfd84d83205112244a994f02dc`
passed Node24 Linux/Windows/macOS run `37874876016`.
PR #61 merged as `802e8826ff6aa32cc4bc6802a27acc704293427e`;
main-push run `37875187063` passed the same three OSes.
The real disposable Git fixture and Native SDK candidate path
proved an exact approved Markdown blob committed on one local
docs branch using a separate temporary index, a pinned base
parent, one changed file, byte-for-byte readback and CAS ref
creation. No original checkout/index modification, filters or
Git hooks were allowed. Missing review, technical UNKNOWN
acknowledgement, dirty human target, symlink and stale base,
malicious path and branch substitution fail closed. This is a
**local branch** acceptance only: no real GitHub DRAFT PR,
review/merge or customer/Platform Publish. See
`evidence/r40/ci-runs.json`.

## R41 accepted — operator-only GitHub DRAFT PR protocol (mocked remote)

Exact source SHA `b0016eaa23cc84cfdd9b290432ecee29cc9edae7` passed supported Node24
Linux/Windows/macOS Application checks run `37875732057`,
which includes the real local Git/Native candidate and deterministic
injected GitHub DRAFT PR protocol regressions. PR #62 merged as
`e577d17da46fd083b03034b80433754784b300d4`; main-push run `37876018118` passed on
Linux, Windows and macOS. The bounded transport requires the
operator to separately push the exact reviewed R40 branch, checks
remote head/base SHA, source repo, open/DRAFT state, complete
title/body and URL, historical PR collision and an explicit
first-send acknowledgement; ambiguous remote outcomes are recovered
read-only and never automatically re-created. No actual owner
GitHub account PR or remote approver/merge/deployment was tested.
The original DOCS_GIT master profile remains PARTIAL; Semwright
Platform Publish and customer execution are not established.
Exact run, job and evidence limits are in
`evidence/r41/ci-runs.json`.

## R42 accepted — exact synthetic editable PPTX and independent PDF

R42 source SHA `9f9bdfbdd6bb219cef3c0e105b1960e476807c6a` passed Node24 Linux/Windows/macOS
application run `37905414198`. PR #64 merged as
`57bcfc6f62b36a420fd223de689b0dddea82abbd`;
main-push checks `37906144764` passed all three OSes.
The exact-merge-sha manual owned document lane `37906146250`
also passed: a Native SDK synthetic frozen Markdown Candidate with
human editorial approval produced an editable native PPTX and real
PDF, independently reopened/rendered with Poppler and LibreOffice.
Source text, line content, page count, binary reproducibility,
checksum, missing edits and private-output replay were verified.
The retained artifact `11604692067` includes PPTX, both PDFs,
renderings and receipts; SHA/run/job boundaries are in
`evidence/r42/ci-runs.json`. Technical state remains UNKNOWN
and no customer branding, rich-media, general accessibility or
independent editorial design-quality acceptance was established.
Original master DECK_PDF remains PARTIAL.

## R43 accepted — offline HTML walkthrough from sanitized Media Evidence

R43 source SHA `7c60976055849c70c0d6ac95960f8282f70bd6f5` passed Node24 Linux/Windows/macOS
application run `37977920432`. PR #65 merged as
`8438ae2b8de8b3c8fdafb53e92111d6d9907c2b0`;
main-push run `37978315864` also passed all three OSes.
The exact-merge-sha real Playwright Chromium manual lane
`37978319215` passed: the owned synthetic offline HTML
navigated two Media-linked screenshots by mouse, keyboard and
network-offline mode, blocked an injected script through CSP,
used no HTTP requests, logged zero page errors and checked
320/390/768/1440px viewports. The retained artifact
`11639548747` includes ZIP/HTML/manifest, original source
digests, CSS-only browser screenshots and the browser report.
Exact run/job/bytes are in `evidence/r43/ci-runs.json`.
This does not certify customer product actions, independent
PII/rights review or canonical Driver Host/Platform execution.
The Native Media output remains imported and technically UNKNOWN.
Original master INTERACTIVE_DEMO remains PARTIAL.

## R44 candidate — store-specific Apple/Google local asset packaging

R44 adds a two-phase local ZIP packager with Apple iPhone Dynamic Island
medium and Google Play phone portrait profiles based on official October
2026 specifications. It checks candidate/channel/source/evidence scopes,
metadata limits, PNG dimensions and channel semantics (store screenshots
and feature RGB; Play icon RGBA), private SHA-locked plan/ZIP/HTML preview,
and recovery without clobbering edited assets. Pixel-to-device/Host
provenance, privacy and actual content rights remain operator declarations,
not independently verified technical PASS. Real App Store/Play Console
accounts, other devices, app binaries, submission and complete store policy
review are not included. Node24 three-OS and owned real Chromium technical
acceptance remain pending. STORE_PACKAGE is still PARTIAL.


## R45 accepted — offline version-bound documentation site

R45 exact implementation SHA `68c8baf1013c4a16346c17c15d47293713144b36` passed
Node24 Linux/Windows/macOS Application checks run `38000276874`.
PR #69 merged as `fdd5462a14d9a143778c0bb524be1559d1c47e8f`, and main-push run
`38000643072` passed all three OSes.
Owned real Chromium workflow `38000643500` passed on the
same merged source, retaining exact offline ZIP, manifest,
source receipts and screenshots at 320, 390, 768 and 1440 px.
The browser report verifies working internal navigation,
keyboard focus, inert code examples, no cross-origin/network
requests, zero failed requests and zero page errors. Native SDK
owned synthetic tests also prove two-release historical site
isolation, stale-source/Candidate/target rejection, declared
source rights, no output clobber and byte-identical private
recovery. An earlier accepted Node24 PR source at
`07fed5f740b9222cbc0c557120bee3f83c67732d`
was superseded by a presentation-only fix suppressing a
trailing blank Native Markdown quote line. All exact CI job
and artifact IDs are in `evidence/r45/ci-runs.json`.
DOCS_STATIC remains PARTIAL: this does not certify production
customer documentation, source rights/privacy, all Markdown/media,
sample execution, WCAG or public hosting. The whole master
remains BLOCKED.

## R46 candidate — aspect-only MP4 source and real Native WebVTT output

R46 introduces a private format-only conversion of one already imported/
reviewed Native Media 1280x720 30fps H264/AAC MP4 into a separately
reviewable 720x1280 portrait MP4 containing the full source image with
black padding and its original audio, together with exact frozen Native
WebVTT sidecar captions. Plan and export are bound to exact
Media/candidate source digests, operator rights/UNKNOWN acknowledgements,
FFmpeg version, private path and output hashes. FFprobe checks codecs,
frames, audio, duration and dimensions. A real owned synthetic fixture
exercises video encoding, byte-stable ZIP, WAV/PCM audio-parity,
partial safe recovery and independent imported/UNKNOWN Native output
custody without inventing canonical Composition execution.
Node24 Linux/Windows/macOS CI (non-FFmpeg portable checks), selective owned Linux video encoding/
audio parity with LAUNCHWRIGHT_VIDEO_REAL_TESTS=1 and human inspection of actual screenshots are required
before accepting this bounded technical subset. Voice alternatives,
burn-in captions, real customer source, editorial film quality,
license/privacy acceptance and upstream Platform Publish remain open.


## R47 candidate — bounded WordPress Posts REST DRAFT adapter

A version-pinned WordPress Channel Profile, approved frozen Candidate and
unsent Channel Package can prepare a private SHA-bound DRAFT intent without
network access. A separately confirmed send uses a private 0600 Application
Password and bounded WordPress REST JSON requests. It creates only a post
in status DRAFT, and verifies the full raw title/content, exact slug,
post type, closed comments/pings and identity before a canonical Native
channel.record_outcome DRAFT_CREATED. Unknown send acknowledgements
require recover-only, which never creates posts or upgrades technical UNKNOWN.
The actual HTTP test suite covers credentials, origin/redirect denial,
source and profile drift, modified or published posts and idempotency.
Supported Node24 Linux/Windows/macOS plus owned genuine disposable WordPress
and MySQL integration CI are still required before R47 acceptance.
No live customer CMS account, rights certification or Platform Publish
acceptance follows from mocked or synthetic-runner tests.

## R48 candidate — bounded local Android emulator screenshot

R48 adds a fixed ADB emulator-only read path, with physical/wireless device
denial, installed package and foreground checks, QEMU identity and exact
Native Source/Release/Target bindings. Its private SHA-bound plan performs
no capture. Explicitly approved capture validates the PNG pixels and
dimensions and commits only an imported technical UNKNOWN evidence receipt,
with exact screenshot/recovery custody, no replay after a lost Native ACK.
Normal Node24 Linux/macOS/Windows CI must pass the injected ADB fault corpus
and Native SQLite evidence tests; the selective Android34 emulator lane
must independently build/launch a no-network owned synthetic APK, take actual
on-emulator PNG pixels, and verify the same code/recovery with exact CI SHA.
No live customer app, physical Android hardware, independent PII/rights
screening, Driver Host, Platform or public publication acceptance is implied.
This narrows ANDROID_CAPTURE from missing implementation to partial after
successful emulator technical acceptance.


## R49 candidate — local iPhone Simulator PNG and Native imported UNKNOWN receipt

R49 adds a bounded Apple CoreSimulator-only adapter that independently
checks a unique booted available iPhone Simulator identity and installed
bundle container, selected approved Native mobile-import Source/Release/
Target pins, exact private plan digest and owner screenshot authorization.
The adapter invokes only fixed simctl list/get_app_container/io screenshot
commands and never boots, installs or launches customer apps or contacts
physical devices. A screenshot is checked with real PNG decoding/CRC and
dimensions, saved privately with a SHA-bound receipt and imported into
the existing Native SDK Evidence state as technical UNKNOWN. A lost Native
ACK recovers from the exact receipt without recapture. Cross-OS Node24
fault tests and a real owned synthetic UIKit/Xcode disposable simulator
lane are REQUIRED for acceptance, not assumed from code existence.
The original master IOS_CAPTURE remains PARTIAL on acceptance; customer
device/app, true binary/foreground isolation, pixel PII screening,
Driver Host/Platform and public App Store upload remain unverified.


## R51 candidate — bounded screenshot upload, no App Review submission

R51 adds owner-confirmed App Store Connect screenshot reservation,
signed-URL multi-part upload, MD5 PATCH upload completion and
asynchronous processing GETs from exact R44 Native Candidate PNG ZIPs.
Operator-selected existing screenshot set/localization IDs and a
private JWT token file are mandatory. The asset transport restricts
signed PUTs to HTTPS Apple blobstore (no bearer JWT), validates all
offset/length ranges, and refuses foreign screenshot bytes/set IDs.
Lost reservation/PUT/PATCH acknowledgements require recover-only.
Eleven owned synthetic tests cover exact source, consent, spoofed URLs,
malformed JWT, wrong locale/set, duplicate reservations and processing
state. No live Apple API/account/screenshot processing, customer device
origin, pixel/rights certification, submission or storefront activation
has been observed. Node24 Linux/Windows/macOS CI remains a requirement
before R51 can be accepted.

## R52 candidate - Google Play existing Edit image upload only

R52 binds one original R44 approved Google Play phone PNG asset ZIP,
frozen Native SDK candidate, source evidence and exact Edit/package/locale
to a private plan. With operator token and explicit SHA consent it GETs
the existing Android Publisher Edit and three image lists, requiring
empty slots, then POSTs only approved PNG bytes and reads SHA-256 image
sets back. Read-only recovery handles lost acknowledgements; foreign
images, expired Edits, tampered sources, duplicate IDs and missing
consent fail closed. No image ordering claim, no Edits insert/commit,
delete/deleteall, Play listing copy write or public app submission exists.
Supported Node24 Linux/Windows/macOS and the selective owned Google
REST HTTP lane are still required before R52 implementation acceptance.
The test fixture is NOT a live developer account, customer app or
semantically reviewed screenshot/rights/privacy certification.


## R54 candidate — two real frozen releases, local continuity and offline review

R54 adds an immutable two-release continuity dossier over real Native
SDK/SQLite candidate state. It binds two release/candidate digests,
checks every frozen artifact SHA and source revision, compares semantic
target+editorial document slots, distinguishes changed release bytes from
unchanged source copy and records registered-only claim/impact/channel
coverage with explicit UNKNOWN frontier. It never copies/reuses assets,
publishes anything or substitutes today’s edits into a historical
candidate. A private operator-approved no-effects plan can export
deterministic offline HTML/JSON ZIP plus SHA-256 and recover a partial
write without clobber. Real disposable owned fixture tests include an
older/younger release and strict failure controls. Supported Node24
Linux/Windows/macOS CI and the separate synthetic Chromium browser lane
at 1440/768/390/320px are required before accepting R54.
The master’s 36 mandatory E2E scenarios still need independently
audited completion; this local 2-release fixture does not claim
customer/Platform/host/semantic coverage authority.


## R55 candidate — exact rectangular pixel redaction and source-linked Native receipt

R55 implements an owner-approved local two-phase PNG transform from an
original Native CAPTURED_ACTUAL/CAPTURED_DEMO_DATA Evidence. Its plan binds
exact original PNG SHA, decoded pixel SHA, Native source/release/scenario
revision pins, 1–24 operator-selected non-overlapping masks, exact masked
pixel count and derived output SHA. Applying an independently confirmed
private plan replaces only those pixels with opaque fixed RGB, verifies
EVERY unmasked pixel is unchanged, strips PNG metadata, and records a
SANITIZED_DERIVATIVE through canonical capture.ingest with
changes-observed-state and technical UNKNOWN. Native and private filesystem
recovery require exact bytes; stale/colliding writes and invalid masks fail
closed. The end-to-end tests integrate new derivative IDs into a revised
R43 Media plan and real offline ZIP without granting observed-state
eligibility or independent privacy certification.

R55 acceptance is still pending supported Node24 Linux/Windows/macOS CI
and the owned-fixture real Chromium/keyboard/privacy-negatives lane.
No real customer PII review, visual source rights audit, universal pixel
safety, application execution, Semwright Driver Host admission or external
Platform/Store publication is implied by this capability.


## R56 candidate — real masked screenshot to Google Play private ZIP

R56 composes R55 exact rectangular PNG pixel redaction and imported
Native SANITIZED_DERIVATIVE Evidence with R44 Google Play portrait store
packages. A mandatory one-to-one source chain matches each R55 plan,
applied receipt, exact 1080 x 1920 image SHA/pixels, Native evidence
version/origin and R44 screenshot. The private R56 receipt binds the
full source lineage to the final R44 ZIP digest. Actual owned synthetic
tests independently compare every output PNG pixel to the original
image plus the explicitly specified opaque rectangles. The ZIP is
accepted by the real R52 prepare-only reader, without any Google Edit
mutation. Stale Native revisions, source mismatches, altered files,
consents and operator locks fail closed, and exact retries recover.
Supported Node24 Linux/Windows/macOS CI and the dedicated owned-source
workflow are required before accepting R56. Neither the original
device-origin PNG, pixel privacy outside masked areas, icons/graphics,
actual Play account, publication nor Semwright Platform execution are
independently verified. STORE_PACKAGE remains PARTIAL and the original
master remains BLOCKED.


## R57 candidate — source-bound R55 masked images in PPTX and PDF

R57 takes a frozen editorial-approved R42 Markdown candidate and exactly
one R55 masked screenshot per content slide. Every input requires a
specific R55 mask plan/input/apply receipt, exact PNG byte and decoded
pixel SHA, Native SANITIZED_DERIVATIVE evidence ID/revision/origin and
the same candidate release/target/build. Technical state remains UNKNOWN
because masks cover operator-selected rectangles only; no independent
PII clearance or source rights certification is asserted. Two-phase
private plan/export embeds the images in replaceable PPTX media and PDF
image XObjects, preserves the original source copy, checks deterministic
binary outputs, and refuses human edits, stale source, swapped screenshots
or concurrent writers. Real owned synthetic Node22 tests passed; Node24
Linux/Windows/macOS and separate owned Poppler/LibreOffice visual
acceptance on an exact SHA are required before R57 is accepted. Original
DECK_PDF remains PARTIAL because rich multi-asset layout, customer visual
quality/accessibility, licensed font coverage and customer/Platform
acceptance are not established.

## Explicitly not established

- Driver Host acceptance is exact-SHA scoped: R22 established the earlier NativeDriver/Effects-readback custody boundary, R28 separately established Driver Host isolation only for the fixed repository-owned DeltaRender/DeltaCLI provider path, and R29 exact SHA `ac83fc358215ec629bf5d7b8abc9de699064862c` separately established the fixed immutable-artifact Effects provider/evaluator plus receipt-admission path. No later SHA inherits any of those results automatically; arbitrary/third-party extension execution, native/browser/Godot mutation-effect correctness, noninterference and scenario-effects authority remain outside those narrower acceptances, and direct-process evidence never substitutes for an exact-SHA Host run;
- live production Platform execution, budgets or billing;
- real customer/project Graph discovery, provider-specific dependency extraction and non-fixture scope/tenant acceptance remain unestablished; R21's owned exact-pinned fixture is Host-accepted but does not establish those production scopes or Platform job authority. Canonical native/browser/Godot mutation-effect, noninterference and scenario-effect execution/admission beyond the narrower immutable-artifact Effects readback also remain external; R9/R12 custody layers do not replace those authorities;
- canonical real customer browser/mobile/Godot product capture; R23 upgrades the owned DeltaDesk fixture to real Broker + Policy + Chromium execution with explicit fail-closed controls, but its CI fixture approval and imported-unverified ingestion still do not establish human/operator approval, Platform/Host authority or real customer capture;
- R24's owned synthetic single-recipe Composition gap is closed only for exact SHA `635bf1c4d02b44bd2da5ab357f408f78aa85388d`; later revisions do not inherit that PASS. Human/operator approval, Platform recipe/job authority, canonical real-customer capture admission, editorial approval and external publication remain unestablished;
- remote tenant/team authentication and canonical shared approvals;
- external public/cross-account Platform Publish execution, consumer job/output ACL acceptance, metering and destination activation;
- ChatGPT Plugin host acceptance;
- commercial-production deployment.

A stored receipt, hash, editorial decision, successful local render or local verifier report must not be described as one of those outcomes.
