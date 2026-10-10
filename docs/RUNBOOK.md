# Operator runbook

## R46 video aspect derivation / operator incident checklist

Do not derive a video from an unreviewed Native Media source or stale
frozen WebVTT Candidate. The operator must confirm original MP4 and
plan SHA, 30fps Media duration, local FFmpeg version, and explicit
rights/UNKNOWN declarations. The export contains the original AAC and
captions as a WebVTT sidecar; portrait footage is contained with
letterboxing and is technically UNKNOWN, not a canonical Composition
Pass. An interrupted export may be retried only with the SAME exact
private plan; if the local ZIP/receipt differs or another operator
owns the workspace lock, stop and manually reconcile. Never modify
the original MP4 or grant automatic external publication.


## R45 documentation source, offline preview and recovery

Only export R45 static documentation from a fresh editorial-approved
Candidate containing a complete set of frozen Markdown pages of the same
release and target. Prepare a private digest-bound source/slug plan and
independently confirm its plan/candidate SHA before exporting into a
0700 directory. Links and code examples are statically validated; the
offline files are not published. If a write is interrupted, repeat the
same plan; any modified ZIP/receipt or stale lock must be examined by
the operator, not overwritten or cleared by guessing. A newer release
gets a distinct private archive and cannot overwrite historical LTS
documentation. Customer accessibility/rights checks and real hosting
are separately required.


## R44 store asset package — private draft and integrity replay

Choose a fresh editorial-approved Release Candidate, an exact store
Channel Profile and approved sanitized capture IDs. Pin private PNG
source bytes, make operator rights/pixel review declarations, and supply
literal listing metadata. Plan without any store operation, then confirm
the saved plan and Candidate SHA in a private output directory. These
PNG/profile checks are not App Store or Google Play approval. On a lost
reply, replay the same intent after inspecting existing files. Reject
edited ZIPs, stale source/channel revisions, unsafe output paths and
wrong screenshot dimensions/alpha. Never automatically resize, publish
or contact external store accounts.

## R43 offline demo screenshot/privacy recovery

Offline demos are static HTML tours of exact Media-backed sanitized
derivatives, not running customer apps. Start with current Media
source versions and approved operator-owned PNGs, inspect every pixel
for PII and rights (metadata stripping is insufficient) before
signing the explicit source-selection JSON. Never publish an UNKNOWN
demo as a real verified product. Re-run the identical private plan
after an interrupted export; unchanged ZIP/manifest bytes and the
original imported Native media receipt are reconciled. On stale
dependency, lock contention, changed pixel hash, foreign evidence,
public output directory or conflicting Media result stop and seek
human reconciliation. No automatic deletion of unknown lock files
or blind changes to the original project.


## R49 owner iPhone Simulator capture and incident recovery

The operator, not Launchwright, boots and foregrounds the selected app on
a local Apple CoreSimulator iPhone. Save the exact private plan and retype
its SHA-256, bundle and release build before capturing. The output is
one private PNG/receipt and imported-UNKNOWN Native Evidence. On a lost
Native response use the SAME original plan; verify screenshot and receipt
before reusing the exact bytes, never launch or recapture blindly.
A locked workspace, moved simulator/app container, source revision drift,
modified screenshot or unsafe output directory requires operator review.
The adapter provides no physical iPhone, source app binary hash, actual
foreground proof, privacy certification or Platform Publish authority.


## R48 Android emulator evidence and incident recovery

Only explicitly selected emulator-PORT devices with ro.kernel.qemu=1 are
eligible. Start/foreground the approved app *outside* the R48 adapter, never
attach a physical phone or use ADB over TCP. Plan the source build/target
and check the full digest before taking the current foreground screenshot.
Output PNG and receipt must remain in a private 0700 directory; the operator
must perform independent pixel PII/rights review before sharing.
A lost Native Evidence acknowledgement can be reconciled by re-running
the same plan using the saved PNG/receipt, without another screencap.
A conflicting original screenshot, missing receipt, unknown stale lock or
changed Emulator/APK-installed identity requires manual review. Build
labels and APK binary hashes remain unverified operator declarations;
never claim canonical Android Driver Host or Platform acceptance.


## R52 Google Play Edit loss and expiration

Keep the exact private R44 ZIP, R52 intent, approved source Candidate
and package/edit identity. Use a 0600 OAuth token file belonging to the
authorized Play operator. Do not create an Edit when another operator
has one in progress. First send requires empty image slots, sufficient
Edit TTL and separate SHA/package/edit approvals. A lost upload
acknowledgement MUST use recover-only; never rerun send, delete remote
images or commit the Edit to hide an inconclusive result. Recovery uses
GET only and marks partial/expired cases for manual Play Console
reconciliation. Local locks cannot prevent another Play user or machine
from changing an Edit. External publication is not authorized here.


## R42 private deck/PDF source and recovery

Use deck-pdf.mjs plan and export only on an exact human-reviewed frozen
Markdown Candidate with a private 0700 output directory. Confirm the
plan and candidate digests from the saved private JSON. The renderer
creates an editable PPTX, a real PDF and an exact hashed receipt.
On an interrupted local file write, replay the SAME immutable plan.
An existing output differing by one byte, an exposed/public output
directory, stale source or unsupported glyph is a stop condition; never
overwrite the human-edited file or silently replace source content.
Human graphic design/accessibility, licensing, technical feature truth,
customer approval and any external publication remain distinct gates.


## R47 WordPress DRAFT recovery

Only send after exact Channel Profile, frozen Candidate, editorial approval,
and original channel package are independently reviewed. Keep the WordPress
Application Password in an owner-only 0600 file; never put it in tool arguments.
Confirm origin, Candidate SHA, original intent digest and --acknowledge-send.
The adapter creates no public posts and refuses remote changes to the
readback raw Markdown projection, title, slug or DRAFT status.
If POST status becomes unknown, use the SAME intent in recover-only mode,
which reads an existing post and never creates another. A stale local
exclusive send lock requires human reconciliation, not automatic deletion.
Public activation, production account permission and Semwright Platform
delivery remain separately authorized.

## R41 GitHub PR draft — no implicit remote retry

R41 only creates a GitHub Pull Request in Draft state after the operator
separately pushes an exact R40 branch. Confirm that gh auth status points
at the intended account, and verify the remote target repository, base,
head, and exact commit SHAs before explicitly sending. A missing pushed
branch or moved base blocks creation. After an ambiguous API response,
use the SAME saved intent with recover-only, and never retry a fresh PR.
A mismatched or closed prior PR requires manual source review; no existing
remote PR content is overwritten. GitHub approval, merge, website
publication, customer acceptance, and Platform Publish are separately gated.


## R40 owned Git docs branch incident and recovery

R40 writes a NEW local Git branch, never a remote PR. On a lost CLI response,
inspect the planned launchwright/docs- prefix branch against its recorded base
parent, exact docs path and SHA-256 bytes; then replay the same original
private plan only. Do not use git push --force or overwrite current human
docs edits. If the base branch advanced or the candidate changed, the plan
is stale and must undergo renewed editorial review and an explicit fresh
plan. No external Git account authority or Platform Publish action exists
in this local branch workflow.


## R38 private local MCP operation and recovery

Launchwright's optional stdio MCP adapter is a **separate local process**
started by an authorized MCP client. Configure its explicit loopback --url,
private --token-file (0600) and --pending-dir (0700), using Node24. The owner
HTTP server must already be running. Never print or paste token contents,
or put them in tool arguments.

For changes: launchwright_prepare creates only a private intent; review the
returned original request_sha256 and intent_key before launchwright_submit.
A lost acknowledgement or uncertain result must be handled with
launchwright_recover **using the same key**, never a substitute intent or
blind retry. The private journal persists until receipt reconciliation;
do not delete it as a shortcut. Publishing/approval tools are not exposed.
If the client cannot authenticate, check the locally owned token file,
loopback URL, and file modes. Never expose stdio transport as a public
HTTP service or claim ChatGPT host acceptance from a local inspector.


## R36 filesystem capacity preflight

Use node src/main.mjs doctor --state <DIR> before importing or rendering
artifacts. The report distinguishes process-temporary space from workspace
space. Free space below 16 MiB reports BLOCKED; below 256 MiB reports
ATTENTION. If the host temporary volume is exhausted but the workspace has
capacity, select a private TMPDIR on an adequately provisioned filesystem
(POSIX) and re-run doctor. Do not delete unknown files, worktrees, CI
receipts, customer data or unrelated caches to make tests pass. Doctor never
performs automatic cleanup, migrations or Native/Host acceptance.


## Before changing the application

1. Confirm the Semwright pin in `SOURCE_LOCK.json` still matches the intended upstream snapshot.
2. Keep local checks lightweight; the workstation has limited free storage.
3. Never treat an old GitHub Actions PASS as evidence for a new SHA.

## Local checks

```sh
npm test
node scripts/verify.mjs
node src/main.mjs doctor --state .state
git diff --check
```

Node 24.21.x is the acceptance runtime. Another local Node version is diagnostic only.

`doctor` never installs, repairs or migrates automatically. It reports unsafe local file permissions, missing/changed Native SDK pins, schema/history state and outstanding intents with remediation text. For an independent reproduction of the documented lifecycle, run `node scripts/clean-room.mjs`; CI records the same report on all three supported runner OSes.

## Heavy acceptance

`Application checks` runs the supported Node runtime on Ubuntu, Windows and macOS. `Native and browser acceptance` is manually dispatched by affected lane:

- `browser`: installs Chromium only on the GitHub runner and exercises the real Launchwright UI.
- `native`: builds the pinned TypeScript SDK, bundles all nine bridge profiles, compiles/tests the real Rust NativeDriver, checks the pinned `semwright-project-graph` contract at the same Semwright SHA and runs the per-profile bridge smoke. Do not move these Cargo/dependency builds to the storage-constrained workstation.
- `stress`: exercises bounded high-volume persistence, observation and portable restore without consuming workstation disk.

Always retain the exact run URL, SHA and artifact name in `ACCEPTANCE.md` after a successful run.

## Usage and billing projection

`usage.reserve` is application-side preflight only: it may not exceed the work budget, but it does not reserve money or capacity in Semwright Platform. `usage.record` retains provider observations idempotently by source/event ID, including externally observed overruns. `usage.adjust` finalizes or corrects the application projection from explicit measured receipt IDs. `usage.inspect` keeps estimate, measured usage, reservation, accounted charge and overruns separate. `billing.test_callback` is permanently test-only and never retries render work or mutates evidence. Reconcile all of these records against canonical Platform ledger/billing receipts before making any financial claim.

## Incident: lost mutation reply

Do not issue a replacement mutation. Recover the original request identity. In the browser, the pending request remains in localStorage until reconciliation. Platform-bound work also keeps its exported request before the one allowed send.

## Incident: uncertain external delivery

If a channel receipt is UNKNOWN and its profile is `recover-first` or `unsafe`, do not retry automatically. Query/reconcile the destination using its provider-defined recovery path, then record a new immutable outcome receipt.

## Legacy workspace history migration

Doctor reports the local schema and whether durable history is ready. A schema-v1 workspace stays readable, but mutations fail closed until the operator explicitly migrates it. Before migration, create an independent filesystem/snapshot backup appropriate to the existing version. Then run node src/main.mjs migrate-history --state .state followed by doctor.

The migration stores the current known revision for every entity and records NOT_RECONSTRUCTED for all earlier history. Do not infer missing revisions from audit events, receipts or external repositories.

## Backup/restore drill

Export a snapshot, restore into a fresh directory, confirm a new workspace generation/epoch, inspect `RESTORE_RECONCILE_REQUIRED` items, and only then resume normal mutations. Old request receipts are intentionally inactive.
