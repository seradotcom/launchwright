# Architecture

Launchwright is an application layer over Semwright contracts, not a replacement for Semwright Platform, Project Graph, Effect evaluation, Composition, Driver Host or Publish.

## Authority boundaries

**Launchwright owns:** release briefs, target context, local source declarations, scenarios, claims, CopyBlocks, ReleaseContracts, ReleaseTemplate drafts, immutable ProductVersion contracts, local deployment/invocation records, immutable editorial artifacts, exact candidate manifests, editorial decisions, verifier/waiver ledgers, channel package manifests, local audit events, portable snapshots and local recovery state.

**Semwright owners remain authoritative for:** native driver execution and Host isolation, canonical Graph observations, canonical effects, Platform jobs/budgets, Composition/AV rendering, canonical verifier admission and external Publish receipts.

The application never converts an imported declaration, screenshot, capture receipt, model result or waiver into a canonical PASS by serialization.

## Request path

UI, public HTTP client, CLI and Native Application bridge converge on `LaunchwrightApplication`. Mutations are bound to an exact request digest, workspace revision, epoch and principal. SQLite commits business data, durable mutation receipt and audit event in one transaction.

Lost replies are recovered by request identity. Reusing an idempotency key with another body conflicts. Observation pagination is bound to one workspace revision.

## Data model

Mutable application resources have stable IDs, opaque generations and monotonic string revisions. Schema v2 archives the exact entity row after every create/update/retire into a separate revision-history table. history.get, history.list and history.diff expose those stored revisions through the same application dispatcher and canonical Native core profile. Legacy schema-v1 workspaces require an explicit migration before another mutation; migration snapshots only the current rows that actually exist and records pre-migration history as NOT_RECONSTRUCTED.

Immutable outputs include artifacts, candidates, verification records, waivers, delivery receipts, impact proposals, document change proposals and their application receipts. A document proposal is bound to the exact resource revision and payload digest it was created from; newer edits make it stale instead of being force-overwritten. Human-owned CopyBlocks and whole-document proposals require explicit human acknowledgement before application. Retirement preserves identity as a redacted tombstone and its tombstone revision is archived instead of silently deleting history.

Artifacts store exact SHA-256-addressed bytes. Candidate v2 freezes artifact hashes plus media metadata, target fingerprints, protected input revisions, claims, ReleaseContract, selected localization/glossary revisions, channel profiles, declared rights, destination and review policy. A protected change makes the old candidate stale rather than silently updating it.

## Editorial release outline from imported Git metadata

R33 generates a deterministic Markdown inventory for human revision from the
already-imported R32 observation. Its preview defaults to counts; including
filenames requires explicit operator acknowledgement and a bounded budget.
Creation uses the existing Native SDK editable deliverable operation with
approved source/evidence revision binding. Human edits are not overwritten.
No product-feature truth, runtime acceptance or Graph authority is inferred.
See the Git release outline guide.

## R47 WordPress post DRAFT via the Native SDK channel journal

The adapter consumes a real frozen, editorial-approved Candidate and its
version-pinned WordPress Channel Profile plus PACKAGE_READY channel delivery.
An offline immutable intent fixes destination HTTPS origin, exact source
Markdown, candidate, title and deterministic WordPress slug. The external
transport sends only POST /wp-json/wp/v2/posts status=draft, with closed
comments and escaped frozen Markdown. Independent GETs compare raw title,
body, slug, type, status and post ID. Only then is a DRAFT_CREATED outcome
recorded via the existing Native SDK dispatcher, not another backend.
Read-only recovery uses the same deterministic slug; no automatic retries,
publishing, updating an existing post or remote account mutation.
The operator stores the WordPress Application Password separately in an
0600 file. The selective CI lane uses disposable WordPress+MySQL, not a
real customer account or a Semwright Platform deployment.
See WORDPRESS_DRAFT.md.


## R46 bounded aspect-only video derivation from Semwright Media custody

R46 reads an exact Native Media plan (two video variants at 1280x720 and
720x1280, 30fps, fixed duration), an editorial-approved Media output,
and a separately reviewed frozen Native WebVTT artifact. FFprobe validates
the approved source MPEG-4 bytes and audio; a bounded FFmpeg process with
no network inputs only makes a portrait H264 image-containment derivative
with the original AAC packets. This does not reimplement the Semwright
Composition temporal clock, effects or narration, and does not execute
customer product scripts. ZIP/VTT/MP4 digests, a private 0700 output
directory, a workspace lock and Native imported/UNKNOWN output receipt
support exact replay and avoid clobbering human changes. No Platform,
external publication, voice variants or customer acceptance is inferred.
See VIDEO_VARIANTS.md.


## R45 — Static version-bound documentation compiler

The owner-selected site plan pins one human-editorial-approved Candidate and
2–12 frozen Markdown artifacts of one release and editorial target. Its
read-only planner parses bounded content, requires a valid internal link
graph and an inert code example, and records all source/target/build and ZIP
digests. The private exporter generates index.html, complete page HTML and
manifest.json without fetching assets, JavaScript or Semwright Platform
jobs. All links target declared local slug files, with a strict CSP and
responsive accessible navigation. Exact-byte ZIP/receipt readback, private
workspace lock and no-clobber recovery preserve historical releases.
See [Static docs architecture/limitations](STATIC_DOCS.md).


## R44 — Store-specific listing PNG profile validation

R44 consumes the exact Native SDK Release, Target, approved frozen
Candidate, versioned external-draft Channel Profile and SANITIZED_DERIVATIVE
capture IDs linked to an approved source. A bounded October 2026 policy
snapshot validates Apple iPhone Dynamic Island medium portrait screenshots
and Google phone screenshots, icon (32-bit RGBA), feature graphic (24-bit
RGB), plus operator-written metadata. The renderer strips PNG metadata
without resizing or changing pixels, creates deterministic private ZIPs
and an offline CSP preview. There is no parallel Native/capture backend,
store-account upload, device-origin attestation or Platform authority.
See [STORE_ASSETS](STORE_ASSETS.md).


## R43 — Script-free offline product screen tour from canonical Media records

The bounded R43 operator CLI reads only a current Native Media plan with
an interactive-demo variant and per-shot SANITIZED_DERIVATIVE Evidence
linked to the original capture, exact release/target/scenario and rights.
An operator separately supplies private PNG source paths, SHA-256,
short labels/alt text and pixel privacy declarations. All PNG bytes are
decoded/re-encoded to discard source metadata and pinned by normalized
pixel hashes, but no pixel privacy claim is inferred.
A two-phase SHA-bound plan/export creates one private script-free HTML ZIP
using static data-image frames, native keyboard radio navigation, strict
CSP, no external links and manifest/source digests. The original app is
never executed; the Native SDK receives an imported-declaration Media
output that remains technical UNKNOWN. CLI lock and exact-byte recovery
avoid blind retries/overwrites. See [the offline demo guide](INTERACTIVE_DEMO.md).


## R49 — bounded CoreSimulator screenshot observation and custody

A new operator-only fixed xcrun simctl adapter reads Apple CoreSimulator's
booted iPhone devices, verifies a selected bundle's installed app container,
and only after separate operator consent reads one screenshot. The screenshot
is validated as a real PNG, normalized without PNG metadata and saved with a
SHA-bound immutable source/release/target/runtime receipt in a private
directory. The existing Native SDK owns any imported Evidence creation;
its technical state stays UNKNOWN and Host acceptance NOT_ESTABLISHED.
The screenshot receipt is reconciled after a lost Native ACK without taking
another screenshot. This does not execute customer application source or
touch a physical iOS device. The disposable Xcode CI fixture separately
installs/launches a tiny owned synthetic UIKit app to prove real simulator
pixels, without altering adapter authority. See IOS_SIMULATOR_CAPTURE.md.


## R48 scoped Android emulator screenshot adapter

The fixed read-only ADB adapter checks local emulator serial and ro.kernel.qemu,
an installed package and foreground state, and an operator-authorized Native
Source/Release/Target bound to a declared build. A two-phase digest-bound
plan ensures the same identity and dimensions before screenshot. The
read-only ADB screencap PNG is CRC-validated and re-encoded without PNG
metadata, saved to private 0700 output with receipt, and imported using
the existing Native SDK evidence.import operation. The screenshot remains
technical UNKNOWN with no canonical Android Driver Host, Platform job,
actual customer or real physical device authority. Recovery reuses the
original saved bytes and reconciles exactly one Native Evidence record.
The owned Android emulator CI app is separately installed/foregrounded
by an intentionally isolated synthetic runner, never by the adapter.


## R54 release-history comparison over frozen Native candidates

The original master requires release progression without erasing previously
approved materials. R54 produces an application-read-only two-release
continuity projection over the canonical Native SDK candidate records and
immutable artifact blobs. Every selected candidate must have fresh input
pins; the report uses declared target/editorial document identities and
compares both source-copy digests and exact rendered binary SHA-256 values.
A second output copy is never promoted to technically unchanged behavior
or automatic reuse. It includes the app's registered-only claim coverage,
impact frontier and channel projections. No local second Graph/Platform
engine exists. A private operator SHA-bound plan builds an offline
HTML/JSON ZIP under a deterministic source digest and a lock; no Native
or external mutation occurs. See
[release continuity documentation](RELEASE_CONTINUITY.md).


## R52 operator-owned Play Edit image staging

The optional Android Publisher v3 adapter validates a frozen R44 Google
Play Candidate, approved local source PNG ZIP, Edit ID, package identity,
source SHA-256 and locale before contacting an operator-owned Play account.
It GETs the existing Edit, GETs three image collections and POSTs only
exact PNG bytes with uploadType=media. It cannot create/commit/delete edits,
rewrite metadata, submit binaries, publish, or infer image ordering from
unordered API results. Lost acknowledgements require read-only recovery
with the original intent. Local write exclusivity does not substitute for
Google Play Console user/tenant isolation. See GOOGLE_PLAY_IMAGES.md.


## R42 immutable editorial candidate to two native document formats

R42 reads one fresh human-reviewed Candidate and the exact frozen Markdown
artifact bytes from the Native SDK-owned workspace. The source parser permits
plain bounded sections and builds a measured common slide model, rejecting
unsupported tables/code/glpyhs or layouts that cannot fit without clipping.
The same layout is rendered to independently opening/editable OOXML PPTX
and real PDF, each parsed back to verify slide/page count. Fixed metadata
and ZIP timestamps make repeat exports binary-stable for recovery with the
same private plan. Only operator-chosen 0700 paths are written; no fonts,
external resource fetch, OS UI automation, GitHub PR or Platform job is used.
The local visual synthetic acceptance is not a customer-quality approval.
See [the deck/PDF export guide](DECK_PDF.md).


## R41 GitHub Draft PR transport after explicit manual branch push

R41 operates on an R40 exact branch which the operator must have separately
reviewed and manually pushed with their own authorization. The saved private
GitHub DRAFT intent pins full base/head SHAs, PR title, complete body,
candidate/artifact SHA-256 and a deterministic request digest. The bounded
GH transport reads remote base/head and historical Pull Requests first; it
creates a PR only with explicit operator confirmation, re-reads the exact
draft/body/owner/refs/URL after creation, and never edits an existing remote
PR. On lost remote send replies, read-only recover requires the original
intent and never silently retries. No branch push, merge, external
publication, Semwright Platform job or ChatGPT-host grant occurs here.
Acceptance currently uses an injected remote provider, not real GitHub
credentials or a live customer repository. See GIT_DOCS_DRAFT_PR.md.


## R40 Git docs branch writeback from an exact frozen candidate

A distinct two-phase operator CLI takes a human-reviewed, exact frozen
Markdown Launchwright candidate and prepares a plan against a pinned local
Git base branch commit/tree. Applying an explicitly confirmed plan uses Git
plumbing: hash-object --no-filters, a private temporary index, write-tree,
commit-tree with the exact base parent, byte/path-only diff verification
and a compare-and-swap update-ref into a NEW local docs branch. Neither
the checked-out project tree nor its default index/HEAD is changed; Git
network, repo hooks, GitHub PRs and external publication are not invoked.
Preexisting local target edits, branch collisions and source/candidate drift
fail closed. This is not yet real GitHub Docs PR integration or Platform
authority. See [Git docs local staging](GIT_DOCS_BRANCH.md).


## R38 — Local MCP tool entry via the public client only

R38 runs the official MCP TypeScript SDK in an owner-configured stdio process,
using solely the public Launchwright HTTP Client SDK. It imports no application
implementation or SQLite state. MCP read tools page inventory/events or
inspect a single Release, impact, candidate or channel. Selected non-publishing
mutations require durable private prepared-envelope custody, explicit key/SHA
confirmation and Native SDK dispatcher validation; recovery looks up only the
original receipt and never automatically resends. The process requires an
owner-owned 0600 token file and a 0700 pending directory and connects only to
the loopback Launchwright service. This is independent-client MCP
interoperability, not ChatGPT Plugin host or Platform acceptance.
See [local MCP adapter](MCP_LOCAL.md).

## R37 — Owner-scoped web onboarding of an existing project

Launchwright's loopback-only web interface offers an opt-in Import Git project
screen before any product is created. Browser file input accepts the exact
private R32 JSON snapshot; changed filenames and private observations are not
stored in browser localStorage. Read-only plan and owner-only apply HTTP routes
enforce the same source validation, exact plan/head digests, independent
rights/approval acknowledgements and fail-closed imported UNKNOWN authority
already accepted in R35. Consumer bearers are denied and the HTTP/CLI routes
share one filesystem-exclusive operator lock. The real Chromium acceptance
checks that the whole flow creates a scoped editorial workspace and keeps
customer/Platform/Graph authority false. See
[local Git onboarding UI](GIT_ONBOARDING_UI.md).


## Existing-project Git bootstrap (R35)

The R35 operator CLI binds an imported R32 Git snapshot to a private, digest-
verified onboarding plan, requires independent commit and plan confirmations,
and reconciles six local domain resources through the existing Native SDK
dispatcher. The product/release/source/target identities and imported evidence
are exact; successful retries reuse records instead of duplicating them.
The saved plan contains no absolute Git path or filenames; no project code is
executed, no upstream Project Graph authority is implied and no Platform/remote
release action is performed. An exclusive CLI lock prevents concurrent
bootstrap attempts, with explicit human stale-lock recovery. See the
[Git project bootstrap guide](GIT_PROJECT_BOOTSTRAP.md).


## Existing Git project source metadata

The R32 operator-controlled adapter accepts only two existing full commit SHAs
in an explicit local Git worktree root, reads bounded name/status metadata via
read-only Git commands and writes a portable digest-bound observation. The
repository path, file content and commit messages are not embedded in the
snapshot. Import uses the canonical Native SDK evidence.import transaction only,
with exact source/build/target/release bindings and an explicit imported-only
acknowledgement. The result is an imported declaration with UNKNOWN technical
state and no canonical Semwright Project Graph, Native Driver Host, Platform,
rights or customer-capture authority. See [Git source contract](GIT_CHANGE_SOURCE.md).

## Project Graph projection and impact

Launchwright consumes Semwright Project Graph through a versioned projection contract locked to the same Semwright source SHA as the Native SDK. It does not ship another graph traversal kernel. An admitted observation is immutable and carries project/snapshot identity, traversal budgets, visible asset mappings, canonical edges/evidence, known/possible impact, UNKNOWN frontier and explicit inventory denominator metadata. Hits and edges that refer to resources outside the authorized visible projection are rejected rather than leaking a hidden dependency path.

The normal HTTP/CLI application session cannot manufacture canonical Graph authority. Only the dedicated owner-pinned `graph` Native profile is provisioned for the application-side admission path, and that path still requires an already completed Platform work record, native receipt digest and `canonical-owner-admitted` result. In the real Rust driver, the bundle is pinned at build time and canonical `NodeBridge` execution additionally requires a Host-mediated sealed runtime tool. Local direct-process profile tests are regression evidence, not Host-isolation acceptance.

Declared/imported/heuristic relations remain local records. `observed` relation provenance requires an exact observed/executed edge in an admitted Graph observation. The application preserves canonical knowledge dimensions and never collapses incomplete coverage into CURRENT. Cycles are not walked locally: Launchwright accepts only already-bounded traversal reports and preserves truncation/cancellation as an UNKNOWN frontier.

Impact planning remains proposal-first. Plans are bound to exact cause revisions and carry no execution authority. Coalescing preserves every changed revision, including multiple revisions of the same resource. Rebuild receipts partition those exact revisions into built versus pending and require a new finalization result for a new final delivery. Cache/reuse assessment binds artifact inputs, target, toolchain, scenario fixtures, templates, verifier versions, tenant, rights, permissions, locale and output profile; a cache hit is never an access grant or inherited final PASS. See `PROJECT_GRAPH.md` for the full boundary.

## Capture and verification

`capture.ingest` records a versioned Launchwright capture contract against an approved source, exact build, target and scenario. Observed capture classes require Platform-job correlation plus a native receipt digest, successful runs require READY checks and exact scenario-anchor cardinality, mutable scenarios require scoped isolation, cleanup cannot remove resources outside the run-owned set, and before/after build observations fail on drift. Sanitized derivatives retain an exact parent-capture relation; generated/editorial/imported material is explicitly ineligible to represent observed product state. This is still provenance, not Host acceptance: technical state remains UNKNOWN until a verifier with the required authority establishes otherwise.

`verification.record` stores verifier identity/version/digest, dimension, coverage, omissions and findings. A PASS is effective only when the caller was provisioned with canonical verifier admission and the record is admitted as canonical. FAIL/ERROR remain failures. A waiver annotates a failure and never rewrites its state. R26 established candidate-wide format verification through the fixed Semwright Driver SDK provider, Broker/Policy/Driver Host and exact Native receipt admission. R30 adds a separate lexical credential-exposure dimension for supported text bytes with redacted findings; a PASS never satisfies broad privacy. Normal HTTP/UI callers cannot mint canonical Host receipts.

## Canonical Effects readback custody

`effects.record` consumes the exact pinned Native SDK immutable-artifact Effects result schema; Launchwright does not implement another evaluator. It stores the protected spec and result bytes by SHA-256, binds exact artifact revisions plus an optional scenario revision, rejects decisive results that do not cover the complete bound artifact set, and recalculates effective state against current bytes/revisions. A canonical PASS is effective only behind explicit `canonical_effect_admission`; a recorded but non-admitted PASS stays UNKNOWN, while canonical FAIL stays FAIL.

This surface remains limited to immutable-artifact readback. R29 accepted the fixed canonical Effects reader/evaluator via Broker/Policy/Driver Host and exact Native receipt admission without conferring execution authority. The upstream scope is `immutable_native_sdk_artifact_properties_only`, with `execution_authority:false` and `scenario_effects_covered:false`. Native/browser/Godot mutation effects, noninterference and authoritative scenario effects remain separate Semwright-owned gates.

## Media composition custody

`media.plan` records a versioned, source-linked production plan with exact rational duration/frame-rate data, observed capture references, sanitized interactive derivatives, narration/music/caption assets, and independent video/screenshot-series/interactive-demo variants. Plans pin every referenced resource revision and compute per-variant digests so a revision can identify which variants remain reusable instead of invalidating unrelated outputs.

Launchwright deliberately does not implement a second media clock, effects kernel, browser kernel or renderer. Motion Canvas handoff and AV execution remain Semwright-owned. Historical R11 evidence kept real-capture MLT rendering and canonical AV coordination as separate proofs. The R24 candidate removes that evidence split for the owned synthetic fixture without forking the kernel: a fail-closed transformer accepts only the reviewed pinned `combined_native.rs` bytes, stages the exact R23 Broker-captured PNGs read-only, imports them as digest-bound managed Motion Canvas assets, and lets the canonical Semwright Composition coordinator continue through Driver Host/MLT, exhaustive audio/sync verification and publication. Launchwright retains and re-hashes the resulting MP4 and evidence. `composition-single-recipe` may report technical PASS only inside the exact-SHA owned-fixture scope; `IMPORTED_UNVERIFIED` capture authority, human approval, Platform execution, customer acceptance and editorial approval remain separate and cannot be inferred from that receipt.

## Channels

A `channel_profile` is versioned product-owned configuration. `channel.package` generates an immutable package manifest pinned to candidate and profile versions but performs no network send. The authenticated loopback download route reconstructs a deterministic ZIP from that manifest, the frozen candidate manifest and content-addressed artifact blobs; repeated downloads therefore preserve exact bytes without storing another mutable archive. External outcomes are separate receipt records. UNKNOWN on non-idempotent/recover-first profiles requires recovery before retry. Public activation requires canonical Publish receipt admission.

## Operator-owned GitHub draft channel

R31 provides an explicit external *draft-only* transport for owned GitHub
repositories, separate from canonical Semwright Platform Publish. Its operator
first commits a private, digest-bound intent, then explicitly confirms repo,
pre-existing tag and exact target commit before any remote API mutation. The
candidate, profile revision and deterministic ZIP bytes are revalidated both
before and after the remote request. The GitHub asset is re-downloaded for an
exact SHA-256 check; wrong tag, reused foreign release, published release or
mismatched asset fails closed. A DRAFT_CREATED outcome is operator-reported
custody only and does not confer public availability or Platform authority.
See [GitHub draft operator flow](GITHUB_RELEASE_DRAFT.md).

## Publish product contracts

A `release_template` is an editable application-owned contract over explicitly authorized source/scenario/claim IDs, bounded public parameters, output classes, destinations, verification dimensions, disclosures, budgets and retention. `publish.version_freeze` creates an immutable `product_version` with exact resource revision pins and a digest; later template edits do not alter that version.

A `publish_deployment` points to one exact ProductVersion and has an explicit ACTIVE → DEPRECATED → RETIRED lifecycle. Consumer invocation preparation accepts only the version's parameter surface, rejects URL/path/secret-style parameter names and out-of-scope resource options, applies a budget ceiling, and deduplicates `(consumer, deployment, invocation_key)` without sharing owner workspace read access. Retiring a deployment blocks new invocations while preserving prior invocation/result custody according to the declared retention contract.

The loopback HTTP server can provision bounded bearer principals for consumer rehearsal. Every request opens the application under that authenticated principal and its exact scopes. Prepared HTTP mutations use a principal-bound v2 envelope; a different principal cannot send it, and durable receipt recovery rechecks the stored principal before returning a result. Consumer credentials never become owner browser cookies. This proves application-side identity/ACL separation on one local workspace, not cross-tenant Platform execution.

Export serializes only the authorized contract/pins and explicitly carries no credentials, grants or permissions. Import requires caller-supplied local resource rebindings and an explicit contract recheck before the imported template may be frozen again. Platform-facing publish work is bound to the exact local template/version/deployment/invocation revision and digest and fails stale before send if that binding changes. These records are preparation/custody only: actual cross-account execution, metering, output ACL enforcement and external activation remain Platform Publish authority.


## Extensibility and non-DOM sources

Extension manifests are bounded descriptors, not executable grants. `extension.prepare_use` freezes the exact extension resource version, package version and digest for one declared input/output contract. Retiring the package blocks new starts and makes existing preparations report `REVOKED_FOR_NEW_START` without deleting historical preparations or observations. Generic views expose typed plain metadata with no trusted markup, remote code execution or capability grant.

The reference second source is an executable CLI fixture. Its process is run outside the application contract, then `source.cli_ingest` records bounded stdout/stderr, exact process timing/exit status, approved source/build pins and optional source-adapter pins. The observation can be inspected for source/target/adapter drift. A successful exit is recorded as process success only; technical state remains `UNKNOWN` because this application does not claim canonical Driver Host isolation or admission from a process receipt.

Extension execution evidence uses the same conservative boundary. `extension.result_record` accepts only a prepared output type, enforces the package output budget, pins the exact preparation/package revision and digest, and records technical state as `UNKNOWN` with `host_isolation_verified=false`. `extension.result_inspect` reports drift/retirement without deleting history. The owned DeltaRender fixture exercises the deliverable-renderer path; the owned mobile importer normalizes a bounded externally supplied bundle and explicitly reports that no device execution was observed.

## Portability

Portable snapshot v2 contains application entities, exact entity revision history, migration provenance, content-addressed blobs, aliases, pending records and audit events. Historical request receipts are exported for forensic continuity but intentionally not activated during restore. Restored uncertain intents are marked RESTORE_RECONCILE_REQUIRED.

Restore also accepts the older snapshot-v1 envelope. Because v1 did not carry entity-history rows, restore archives only each current entity revision and records that earlier snapshot history was NOT_RECONSTRUCTED; it never synthesizes old revisions from audit events.
