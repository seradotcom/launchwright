# R68 — Native-reviewed Markdown to a local Git branch from the UI

R68 connects the **existing** R40 Git docs branch engine to the authenticated
Launchwright browser. It does not create a second source-of-truth or Git
renderer. The accepted input is an immutable Semwright Native SDK-backed
Candidate and an exact Markdown Artifact in that Candidate, after human
editorial approval. Technical UNKNOWN remains UNKNOWN.

## Operator steps

1. Open Launchwright's local UI and log in with the local owner token.
2. Render a Markdown Deliverable in **Deliverables**; freeze and approve its
   Candidate in **Review room**. Do not mistake editorial approval for
   technical or licensing clearance.
3. Open **Docs to Git** and choose **Prepare reviewed branch**.
4. Supply an absolute path to an existing Git worktree that you control, a
   declared GitHub `OWNER/REPO`, existing local base branch (for example
   `main`), and a safe `docs/*.md` destination. Select the frozen Candidate
   and its Markdown Artifact; acknowledge the private draft and UNKNOWN state.
5. Verify the SHA-256 plan, candidate and 40-character Git base commit. Save
   the JSON plan from the browser to a **private** location. The path and plan
   are never stored in localStorage.
6. Choose **Create or reconcile local branch** and **retype** all three hashes;
   explicitly authorize writing one local Git branch. A lost HTTP response
   must be reconciled with **Read branch status** — **not** by creating a
   replacement plan, automating a retry or changing an unverified branch.
7. After a reload, **Restore exact saved plan** using the original JSON and
   Git root; the server verifies the Native candidate, Git base and exact
   branch. It does not perform a write.

The branch is named `launchwright/docs-<plan-prefix>`. The R40 Git plumbing
writes one blob and one commit using a private temporary index, verifies the
parent, file list and exact Markdown bytes, then performs a compare-and-swap
reference update. Git checkout, HEAD, index, unrelated edits, hooks and
filters are not touched. Changed base, dirty destination, incompatible
preexisting branch and stale source fail closed. A manually changed branch
does not get rebased or replaced.

## Security and scope

The three HTTP operations `/api/v1/local-git-docs/{plan,apply,inspect}`
are **POST, localhost and authenticated-owner only**. Consumer bearer scopes
are rejected. The server enforces same-origin, JSON budgets, exact request
fields, fixed local Git semantics and an exclusive R68 writer lock. No URL,
arbitrary Git command, script, user-chosen Git arguments, PR token or shell
body enters the Git operation.

The plan response binds the repository's **root hash**, not its absolute
pathname. Browser session memory holds the working root and plan until it is
cleared or the page reloads. Saving the plan is a deliberate browser download,
not a server-side secret or implicit write.

**This is not GitHub publishing.** R68 does not push, create a remote branch,
open a PR, merge it, deploy docs, run a customer project, or create a Semwright
Platform job. R41 is a **separately authorized** remote DRAFT PR workflow,
available only after operator review and manual push. A local branch does not
prove permission to publish or consent from a customer.

## Verification

- `node --test --test-concurrency=1 tests/git-docs-web.test.mjs tests/git-docs-ui.test.mjs`
  covers deterministic plans, exact Native candidate SHA, one-file Git branch,
  owner-only authentication and cross-origin denial, tampering, stale state,
  held writer lock, human dirty-file protection, branch collisions, no hooks,
  preserved HEAD/index, unknown-outcome reconciliation and no implicit sends.
- The official Node 24 application matrix covers Linux, Windows and macOS.
- The R68-owned Chromium lane exercises the UI and browser private-plan
  export/import against a real disposable Git repository, with 1440/768/390/320
  px screenshots and exact Git readback, and retains evidence for that SHA.

This narrows the master `DOCS_GIT` profile. Independent customer source
authorization, human review/merge, hosting, Semwright Platform Publish,
rights, privacy, accessibility and actual public delivery are still external.
The whole-master gate remains **BLOCKED**, not 100%.
