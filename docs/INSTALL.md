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


## Optional R43 offline interactive demo from existing Media Evidence

Use [the offline walkthrough instructions](INTERACTIVE_DEMO.md) with an
existing, current Native Media plan and per-shot sanitized-derivative
Evidence. The operator must already own/authorize private PNG files
and verify screenshot pixel privacy. Two-phase plan/export produces
a private 0700 ZIP/receipt without source app execution or network use.
A GitHub Actions synthetic owned Browser lane verifies the user interface
independently. This is not real customer capture or an externally
hosted/deployed interactive application.


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
