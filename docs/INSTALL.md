# Install and local operation

Launchwright is a local-first developer preview built on Semwright Native SDK 1.0.0, pinned to the published Semwright v1.0.0 release commit.

## Supported runtime

Use Node 24.21.x. The repository declares `>=24.21.0 <25`; results from other Node versions are supplemental only.

```sh
npm ci --ignore-scripts --no-audit --no-fund
node src/main.mjs init --state .state
node src/main.mjs serve --state .state --port 4317
```

The server binds loopback only. Read the generated `.state/session-token` locally and enter it in the login screen. Do not put that token in a URL, git, screenshots, release packages or automation logs.

For a local consumer-identity rehearsal, create a private JSON file outside the repository with mode `0600` on POSIX and schema `launchwright-consumer-auth/1`. Its `principals` array contains `{token, principal, scopes}` records and this consumer-only surface accepts only the `consume` scope. Start with `node src/main.mjs serve --state .state --consumer-auth /private/path/launchwright.consumer-auth.json`. The file is read only at server start, is not stored in SQLite or snapshots, and `*.consumer-auth.json` is ignored by git. This remains a loopback development boundary, not remote tenant authentication.

## Optional GitHub Release draft workflow

Launchwright does not send packages to GitHub automatically. A repository owner
can install/authenticate GitHub CLI and use a two-step operator-authorized
prepare/send workflow, bound to an existing remote Git tag, approved candidate,
and exact immutable bundle. This creates a GitHub **draft**, never publishes a
release. It does not establish Semwright Platform Publish authority.
See [GitHub draft instructions](GITHUB_RELEASE_DRAFT.md).

## Editable release outlines from Git evidence

After importing an approved R32 observation, an operator may use
scripts/git-release-outline.mjs to preview a bounded inventory and create
an editable Markdown deliverable. Preview makes no domain changes; creation
requires a human-review-only acknowledgement.
See the Git release outline guide.

## Optional local MCP tool entry (R38)

Start the normal owner-authenticated loopback Launchwright server. Configure
a local MCP client to execute scripts/mcp-local.mjs using the explicit
--url, private --token-file and private --pending-dir arguments. MCP input
never receives the token itself. The ten bounded tools use the public HTTP
Client SDK and do not expose approvals or Publish actions. Follow
[local MCP operator instructions](MCP_LOCAL.md). MCP interoperability in
a local client is not host-side ChatGPT Plugin acceptance.

## R62 private burn-in for R46 frozen WebVTT and two MP4s

With an R46 reviewed Native Media source and its private ZIP/JSON receipt,
use video-caption-burnin.mjs plan and export to create captioned variants.
Burn-in execution is Linux-only and requires FFmpeg with libass plus an
installed DejaVu Sans font. A known-good Node24 Linux CI lane is separate
from the portable three-OS contract checks. The original AAC and source
source files remain unchanged; any derived technical state remains UNKNOWN.
See VIDEO_CAPTION_BURNIN.md for exact operator consent/digest steps.


## R46 two-format video and Native WebVTT review

Install and authorize local FFmpeg/ffprobe (or use the selective owned
video runner). Select only a real private H264/AAC source MP4 already
SHA-bound to an editorial-approved Native Media output, and frozen
human-reviewed Native WebVTT captions of the same Release and Target.
Then run scripts/video-variants.mjs plan and export with independent exact
source/plan SHA confirmations, to a private 0700 output directory.
See VIDEO_VARIANTS.md. FFmpeg codec and source parser safety depend on the
host's tooling and isolation; no alternate Composition or Platform is
installed.


## R45 owned offline documentation sites

After creating and obtaining editorial approval for at least two frozen
Markdown artifacts in the same Release/Target, use the R45 two-phase
plan/export CLI to build a script-free site in a private owner directory.
The site includes checked internal navigation, code examples, a static
index and a source/build manifest. It is deliberately not deployed on a
public hosting service. See [Static documentation](STATIC_DOCS.md).


## R44 local App Store / Google Play technical asset packs

Launchwright can prepare private store-specific PNG/metadata bundles
from exact approved Candidates and operator-selected sanitized screenshots.
Follow [STORE_ASSETS](STORE_ASSETS.md). Source selection and outputs must
remain private. No automatic screenshot resizing, Apple/Google network
operation, actual mobile-device execution or Store approval is implied.


## Optional R61 click-through offline walkthrough

First generate a current R59 masked Native Media offline bundle with its
private plan, request, source ZIP and receipt. Define 1–20 screen-to-screen
click zones in an operator-private JSON file (source-pixel coordinates),
then prepare/confirm/export the bounded R61 derivative via the
[offline hotspots guide](OFFLINE_HOTSPOTS.md). It needs no browser plugin
or network and changes no Native Media output. Pixels outside R55 operator
rectangles remain unverified for privacy.


## Optional R59 masked offline walkthrough

After completing the R55 pixel-masking and current R43 Media plan
with Native derivatives, use the operator-only private R59 plan/export
workflow from [MASKED_INTERACTIVE_DEMO.md](MASKED_INTERACTIVE_DEMO.md).
Each displayed screen must use the exact R55 derived pixels, not merely
an arbitrary operator-sanitation label. Input JSON is private (0600),
output preexisting folder is 0700; nothing is executed or published.
Privacy outside masked regions still requires independent review.


## Optional R43 offline interactive demo from existing Media Evidence

Use [the offline walkthrough instructions](INTERACTIVE_DEMO.md) with an
existing, current Native Media plan and per-shot sanitized-derivative
Evidence. The operator must already own/authorize private PNG files
and verify screenshot pixel privacy. Two-phase plan/export produces
a private 0700 ZIP/receipt without source app execution or network use.
A GitHub Actions synthetic owned Browser lane verifies the user interface
independently. This is not real customer capture or an externally
hosted/deployed interactive application.


## R58 mask-linked Apple asset staging

For private App Store screenshots, use explicit R55 pixel masks and
Native derivative receipts, then R58 plan/export/apple-plan to bind
exact masked source pixels to the R44 ZIP and R51 screenshot intent.
Only an operator with an existing App Store Connect account,
screenshot set and private JWT may send. R58 does not submit apps
for review or certify that all PII was removed. See
[masked Apple instructions](MASKED_APPLE.md).


## R51 Apple screenshot asset preparation

Start with the private R44 Apple iPhone screenshot ZIP and exact approved
Candidate. R51 optionally reserves and uploads those screenshots into an
existing operator-created App Store Connect screenshot set, using a
short-lived JWT token file. Prepare a private SHA-bound intent first,
then type all confirmations before any remote asset request. On lost
responses use GET-only recovery; an AWAITING_UPLOAD asset requires
manual operator reconciliation, not retry. The adapter never submits an
app to review, activates a storefront or invokes Platform Publish.
See [APPLE_SCREENSHOT_UPLOAD.md](APPLE_SCREENSHOT_UPLOAD.md).


## Optional iPhone CoreSimulator screenshot (R49)

On an operator-authorized macOS machine with Xcode/CoreSimulator, manually
boot a local iPhone Simulator and install/foreground your authorized app.
Create an approved mobile-import source with ios-simulator:BUNDLE_ID locator,
matching Release build and target viewport. Use the two-phase CLI in
[IOS_SIMULATOR_CAPTURE.md](IOS_SIMULATOR_CAPTURE.md) to plan and explicitly
capture one screenshot in an existing private output folder. Technical,
foreground/installed-build, privacy and rights truth are not upgraded by
this process. No real device, remote Apple account, GitHub/Platform or
external publication is used.


## Optional Android emulator screenshot (R48)

With the Android SDK Platform Tools installed, independently start a
local emulator and foreground a deliberately approved package. Create an
approved Launchwright mobile-import Source linked to the same Release
build and a Target matching the emulator display. Use the exact two-phase
Android plan/capture command in
[ANDROID_EMULATOR_CAPTURE.md](ANDROID_EMULATOR_CAPTURE.md). It only reads
an emulator screenshot and imports UNKNOWN evidence; never attach an
actual phone, supply a network ADB target or claim Semwright Android
Driver Host/Platform authority. The synthetic Android CI lane is separate.


## Optional R52 Google Play uncommitted Edit staging

This adapter requires an existing operator-owned Google Play Edit,
an approved R44 Google phone image ZIP, a private OAuth token file and
explicit immutable SHA/package/edit confirmations. It cannot commit the
Edit or publish an app and never blindly retries an ambiguous image POST.
See GOOGLE_PLAY_IMAGES.md. Real Google account, image ordering and
customer pixel/rights approval are external obligations.


## R57 private Native-masked screenshot presentation

After approving a frozen Markdown candidate and obtaining a set of exact
R55 masked PNGs/Native SANITIZED_DERIVATIVE receipts, follow
[MASKED_DECK.md](MASKED_DECK.md). The optional local CLI composes one
screenshot per Markdown section into editable PPTX and real PDF with
SHA lineage, using an owner-private output directory. Only operator-
declared mask coverage is established; no independent pixel privacy
certification or external publishing occurs.


## R56 masked Google Play screenshot integrity handoff

After R55 produces exact operator-owned masked PNGs, use the R56 private
two-phase plan/export workflow in MASKED_STORE_HANDOFF.md to bind each
R55 Native SANITIZED_DERIVATIVE receipt and output SHA to an R44 Google
Play phone listing. The result is a private R44 ZIP + two receipts,
never a Google Play Edit or published listing. Original source PNG
paths remain private. Other store sizes and external account privacy/
rights acceptance remain outside this restricted workflow.


## R55 private pixel mask preflight for captured screenshots

When downstream product demos require obscuring an owner-reviewed region,
use the two-phase R55 operator CLI described in
[PIXEL_REDACTION.md](PIXEL_REDACTION.md). This is an explicit opaque
rectangle transform on an approved Native capture + exact PNG, not
automatic PII detection and not a new source/Platform execution backend.
It creates private RGB PNG/measurement output and a separately linked
SANITIZED_DERIVATIVE receipt with technical UNKNOWN.


## R42 editable deck and real PDF

From a human-approved, exact frozen Markdown Candidate, execute the
two-phase plan/export commands in [DECK_PDF.md](DECK_PDF.md). The output
directory must already exist with 0700 owner permissions on POSIX. It
receives a real editable PPTX, a real PDF and a private source SHA receipt.
The operation has no external side effects; imported/UNKNOWN technical
evidence remains UNKNOWN. Unsupported font characters or rich Markdown
fail closed rather than displaying replacement glyphs.


## R47 WordPress CMS DRAFT adapter

Create a wordpress-post-draft Channel Profile for one approved HTTPS origin,
pin it to the frozen Candidate, record editorial approval, and produce a
Channel Package. The separate WordPress Application Password lives in
a private owner-only JSON file. Use the R47 CLI to plan, explicitly send,
or read-only recover exactly one remote WordPress DRAFT. This never
publishes or grants upstream Platform authority; see WORDPRESS_DRAFT.md.


## Optional operator-reviewed GitHub DRAFT PR (R41)

R40 creates a local branch. Independently verify and push that exact branch
to an owned GitHub repository using the operator's existing Git tooling,
then use the R41 two-phase intent in docs/GIT_DOCS_DRAFT_PR.md to request
a GitHub Pull Request in DRAFT state. A lost response must use recover-only.
This adapter never pushes source, merges, publishes or grants Platform rights.
No live GitHub acceptance follows from the mocked tests.


## Local Git docs review branch from an approved candidate

With the local Launchwright workspace, an approved editorial candidate
and an owned Git repository, use the two-phase R40 operator CLI to prepare
an exact private plan for one docs/*.md file and explicitly create a new
Git branch. The current checkout/index/HEAD are not modified. There is no
GitHub push/PR. See [Git docs review branch](GIT_DOCS_BRANCH.md).


## Review changes between two frozen releases (R54)

Choose distinct historical/current release IDs and their frozen candidate
IDs from the existing Launchwright workspace. Run the private two-phase
continuity CLI (scripts/release-continuity.mjs) to prepare the exact
read-only comparison and export a private HTML/JSON ZIP. A previously
edited source, ambiguous target/doc slot, changed candidate digest or
unreviewed coverage boundary fails closed. This process does not require
GitHub, Semwright Platform or source-project execution and does not
constitute a public release. See [continuity review](RELEASE_CONTINUITY.md).


## Optional R37 web onboarding for an existing project

Start the local owner-authenticated UI, select Import Git project, and upload
a private R32 observation JSON using the browser picker. Plan without
mutating, save or reselect a matching private plan, then explicitly type the
plan SHA and head commit plus four operator acknowledgements. The server
never accepts an arbitrary Git filesystem path or runs customer code;
the existing Native SDK dispatcher creates scoped editorial resources only.
See [local Git onboarding UI](GIT_ONBOARDING_UI.md).


## First-time bootstrap from a preexisting Git project

The operator can create an exact, private two-phase onboarding plan from
an R32 Git observation, then confirm the plan/head SHA and independently
approve source purpose, rights declaration, imported data and editorial
draft status before creating the six local Native SDK domain resources.
It is crash-recoverable and never fetches or executes the source project.
See [Git project bootstrap](GIT_PROJECT_BOOTSTRAP.md).


## Importing source metadata from an existing Git project

An operator can scan two exact local commit SHAs without fetching or
executing project contents and import the resulting digest-bound metadata as
UNKNOWN evidence via the Native SDK. Requires Git installed and an approved
CLI source/build/target. No automatic capture or canonical Graph claims.
See [Git source adapter](GIT_CHANGE_SOURCE.md).

## Local disk capacity diagnostics

Run node src/main.mjs doctor --state .state before working with large
captures/imports. R36 separately reports the process temporary filesystem
and the workspace filesystem, including conservative free-MiB thresholds.
Below 16 MiB is a blocking error; below 256 MiB is a warning. If the
process temporary filesystem is full, choose a private alternative TMPDIR
(on POSIX) on a filesystem with available space and run doctor again.
Do not remove unrelated project or user files automatically.

The doctor is observational only; it neither creates state directories
nor cleans caches, downloads, artifacts, credentials or workspaces.
Unsupported filesystem capacity probes return UNKNOWN rather than a
fabricated OK. On Windows, if capacity reporting is unavailable, check
the location and free space manually before heavy operations.

## Empty and synthetic workspaces

`init` creates an empty workspace. `demo` adds only synthetic editorial data and does not represent native product capture.

```sh
node src/main.mjs demo --state .state
node src/main.mjs doctor --state .state
```

## Existing schema-v1 workspaces

New workspaces initialize with durable revision history. If doctor reports history_ready false, keep the workspace backed up and perform the explicit migration before any further mutation with node src/main.mjs migrate-history --state .state. Migration preserves the current stored revision for each entity; it does not reconstruct older revisions that the previous schema never retained.

## Portable recovery

Create an offline JSON snapshot:

```sh
node src/main.mjs snapshot --state .state --out launchwright-snapshot.json
```

Restore only into a new workspace:

```sh
node src/main.mjs restore --snapshot launchwright-snapshot.json --state .state-restored
```

Restore changes the workspace generation, advances the request epoch, does not reactivate old mutation receipts, and suspends uncertain pending work for explicit reconciliation.

## Heavy dependencies

Do not install Chromium, compile the Rust NativeDriver, or build the canonical SDK merely to use the local editorial workspace. Those acceptance lanes run in GitHub Actions. See `RUNBOOK.md`.
