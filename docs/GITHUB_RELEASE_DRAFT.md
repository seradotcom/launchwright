# Operator-owned GitHub Release drafts — R31

Launchwright can prepare **real GitHub Release drafts** from immutable candidate
ZIP bundles using a GitHub-authenticated operator CLI. This is **not** Semwright
Platform Publish, not a published release, not public activation, and not remote
multi-tenant authorization.

Nothing is sent when an owner creates a channel package. External action needs
a saved exact intent, an approved editorial review, and separate repo/tag/candidate
confirmations.

## Prerequisites

Use Node 24.21.x and an existing local workspace. This bounded adapter targets github.com only (GH_HOST must be unset or github.com). GitHub Enterprise hosting is outside its accepted scope. Install `gh`
and authenticate as an operator with write access to the destination GitHub
repository. The GH CLI owns credentials: Launchwright does not read or persist
GitHub OAuth/PAT tokens.

Create an existing remote tag pointing to the exact 40-character lowercase
commit SHA. Annotated tags are supported to a bounded dereference depth.
**Launchwright never creates, moves, rewrites or deletes tags.**

Create a product-owned channel profile with these exact properties:

```json
{
  "channel": "github-release-draft",
  "destination_class": "external-draft",
  "source": "github-release-draft:OWNER/REPO",
  "requirements": {"format": "zip"},
  "idempotency": "recover-first"
}
```

Freeze a candidate with the profile in its channel_profile_ids, a Markdown
or text release-notes artifact in artifact_ids (maximum 64 KiB UTF-8), and
record an APPROVED_EDITORIAL review of that candidate. Create an immutable
channel.package with PACKAGE_READY state. Failed or stale gates block the
external draft; UNKNOWN technical/capture coverage requires explicit
operator acknowledgement and is never treated as PASS.

## Step 1 — prepare without network side effects

```sh
node src/main.mjs github-draft-plan \
  --state .state \
  --delivery channel_delivery_UUID \
  --repo OWNER/REPO \
  --tag v1.2.3 \
  --commit 0123456789abcdef0123456789abcdef01234567 \
  --title "Product v1.2.3 (draft)" \
  --notes-artifact artifact_UUID \
  --acknowledge-draft-only \
  --acknowledge-unverified \
  --out /private/launchwright-v1.2.3.intent.json
```

Replace the sample SHA with the real remote tag target and the example
IDs with existing workspace identities. Omit --acknowledge-unverified only
if all candidate technical gates are PASS.

The intent file is exclusively created with permissions 0600 on POSIX and
stores NO credentials. It binds delivery, candidate and package manifests,
exact ZIP bytes/hash, selected notes bytes/hash, pinned channel-profile
revision, repo, tag, target commit, title and operator acknowledgements.
The plan phase performs no GitHub network action.

## Step 2 — create or recover the draft explicitly

```sh
node src/main.mjs github-draft-send \
  --state .state \
  --intent /private/launchwright-v1.2.3.intent.json \
  --confirm-repo OWNER/REPO \
  --confirm-tag v1.2.3 \
  --confirm-candidate FULL_64_CHARACTER_CANDIDATE_SHA256
```

Launchwright rechecks the entire frozen candidate, review and ZIP, verifies
the existing GitHub tag and commit, and uses `gh release create --draft
--verify-tag` only if that tagged release does not already exist.
It never auto-creates a Git tag, enables auto-publish, or generates notes
from unreviewed GitHub repository contents.

The draft body includes the explicitly selected release-notes artifact plus
a private SHA-256 intent marker. A pre-existing unrelated release, or one
that is already published, cannot be adopted or modified.
R34 also compares the **exact approved release title and full Markdown notes**
against the GitHub draft at every admission boundary, not just the embedded
intent marker. CRLF versus LF line-ending normalization is permitted; extra
text, deleted text or title changes fail closed, including if another operator
edits the draft during an asset upload. The existing asset is not clobbered
and no local success is recorded after remote content drift.
R34 acceptance passed on exact SHA 1e7a700e6d4ea2b9104ceb76ca0b15650a5d30d9 in the Node 24 Linux/Windows/macOS matrix. This covers mocked GitHub transport, not a live GitHub API draft.


The deterministic ZIP is uploaded without --clobber. Afterward the CLI
downloads the actual asset, compares the bytes and SHA-256, then rechecks
the GitHub release is still draft. Only then is an operator-observed
DRAFT_CREATED channel outcome stored through the real Semwright Native SDK
application dispatcher. It is NOT canonical Platform publication authority.

## Recovery and partial failure

An interrupted request may have created a remote draft with no recorded
local outcome. Use this read-only remote recovery command:

```sh
node src/main.mjs github-draft-recover \
  --state .state \
  --intent /private/launchwright-v1.2.3.intent.json \
  --confirm-repo OWNER/REPO \
  --confirm-tag v1.2.3 \
  --confirm-candidate FULL_64_CHARACTER_CANDIDATE_SHA256
```

Recover-only never creates a draft or uploads an asset. If a matching
remote draft exists but the asset is missing, the operator can deliberately
rerun github-draft-send with the same saved intent, after inspecting remote
state. A matching existing asset is downloaded and verified, never overwritten.
A changed repo/tag/commit, publication status, marker, candidate, asset size,
digest or downloaded bytes fails closed.

Repeated success returns the prior local DRAFT_CREATED record rather than
creating a duplicate channel-outcome event. No automatic retries are issued
by the adapter for unknown external outcomes.

## Authority, security and limitations

- Repo must be exact OWNER/REPO; tag is a single safe component; commit is
  an exact lowercase SHA. No caller-supplied executable paths or GH flags.
- The GH command runner never uses a shell and suppresses sensitive stderr
  from user-facing errors. Temporary assets and notes are stored in private
  directories and removed after each command.
- The ZIP may contain proprietary or sensitive data. The operator selects
  its content and is responsible for the destination repository access.
  R30 credential-exposure patterns are a narrow signal, not a complete
  privacy/PII/rights/security audit.
- A GitHub draft does not grant public availability. Later publishing in the
  GitHub UI is a separate human action outside Launchwright's authority.
- This path does not establish Semwright Platform Publish, scheduler/jobs,
  tenant identity, cross-account ACLs, billing or external activation.

## Tests and acceptance

Unit and contract tests build real Launchwright candidates, channel packages,
frozen ZIPs and SQLite delivery records through the canonical Native SDK
dispatcher, while the GitHub transport is mocked and has **no network**.
They exercise the GH CLI argv (draft/verify-tag/no-clobber), tag dereference,
remote SHA/download, loss/recovery and policy denial on Linux/Windows/macOS.

A green mock run is **not proof of a real GitHub API upload**. That requires
separately authorized acceptance against an operator-owned disposable
repository, without publishing any release.
