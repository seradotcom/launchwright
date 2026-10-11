# R69 — GitHub Draft PR from the local Launchwright UI (R41)

R69 exposes the existing exact R41 GitHub DRAFT PR integration to the
Launchwright browser. It builds on [R68 local Git docs branches](GIT_DOCS_WEB.md),
which reuse the Semwright Native SDK and R40 code. This is not a new publisher,
and no external GitHub mutation is executed without an operator action.

## Operator sequence

1. Create a frozen Markdown candidate and record explicit human editorial
   approval in Launchwright. Prepare and apply its R40 plan under **Docs to Git**.
2. Review the exact local branch and its single-file diff. **Separately push**
   that exact branch to the approved GitHub `OWNER/REPO` using your normal
   Git credentials and change control. Launchwright intentionally does not
   push, fetch, merge or execute repository scripts.
3. Back in **Docs to Git**, choose **Prepare GitHub Draft**. Type the title,
   reviewer note and acknowledge Draft-only behavior. This step verifies the
   frozen Candidate and locally created branch but **does not contact GitHub**.
4. Save the R41 intent JSON privately. Review its complete SHA-256, R40 plan
   SHA-256, Git repository, and full local commit SHA. Only then select
   **Authorize first Draft PR send**, retype the repository, branch-plan hash
   and commit SHA, and explicitly acknowledge both manual push and the remote
   Draft PR creation request.
5. The existing `gh` CLI/owner credential configured on this machine handles
   the GitHub request. R41 verifies that the remote base/head are exactly the
   approved local SHAs, discovers historical PRs, creates only a GitHub DRAFT
   when necessary and reads back the exact title, body, commits, refs and
   GitHub URL. It neither approves nor merges the PR.
6. **Unknown outcome**: if the HTTP or GitHub response is lost, NEVER send
   again blindly. Click **Recover exact remote Draft (read only)** with the
   same R41 intent. On reload, restore the original R40 plan and R41 intent
   JSON; verify them before read-only recovery. Absent, moved, closed,
   rewritten, non-DRAFT or ambiguous remote PRs fail closed.

## Authority / security

Endpoints under `/api/v1/local-git-docs-draft/{plan,send,recover}`
are **owner-authenticated only** and inherit localhost/Host/Origin protections.
The send endpoint also demands local `publish` capability plus independent
confirmations; non-owner consumers are denied. Browser inputs contain no
GitHub token, and private plan/intent JSON remains only in memory unless
explicitly downloaded. No auto-retry or background effect performs PR creation.

The R41 GitHub transport is restricted to `github.com`, bounds operations to
allowlisted GETs and Draft POST, and verifies local and remote source hashes.
Its live owner-account transport was previously exercised and cleaned up by
R66 with an owned synthetic Draft PR. R69 CI uses an **injected synthetic
GitHub provider** to avoid creating PRs in customer or public repositories.
The real provider still requires manually configured operator `gh` login.

R69 does not push commits, authorize customer source, approve code review,
merge a PR, deploy hosting, publish a website, establish general content
privacy/rights/accessibility, create a Platform job or grant Semwright
Platform Publish authority. DOCS_GIT remains PARTIAL; the master remains
BLOCKED pending independent customer, account and publication acceptance.

## Test evidence

- Local Node tests use disposable Git worktrees, actual Semwright Native
  candidates and a deterministic GitHub transport. They verify owner-only
  authorization, missing pushed branch, stale SHA, exact bounded Draft, remote
  readback, lost acknowledgment/recover-only, tampered intents and no publish.
- Node 24 CI runs the full application suite on Linux/Windows/macOS and
  selectively tests R41/R69 on Linux.
- Chromium acceptance at 1440/768/390/320 px exercises an actual local
  Native→Git→UI path with *simulated manual push and injected GitHub DRAFT*,
  saved plan/intent and reload recovery. It is **not** real-account customer
  acceptance or a real GitHub PR creation.
