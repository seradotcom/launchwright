# R40 — Draft documentation changes from an approved candidate into local Git

R40 connects the existing versioned **Launchwright Markdown candidate** to an operator-owned Git documentation working tree. Unlike R32 (read-only metadata) or R35 (onboarding), R40 performs a real, controlled **Git write**. It makes exactly one new branch with a single modified or added Markdown file. It does **not** push a branch, create a GitHub pull request, publish documentation or contact a third-party server.

This local Git staging step is only part of the original master's DOCS_GIT profile. **Remote PR creation, owner account authentication, review/merge authority and real customer repository acceptance remain unimplemented.**

## Preconditions

- A reviewed Launchwright candidate with a frozen Markdown artifact, and a human editorial decision of **APPROVED_EDITORIAL** on that same exact candidate SHA.
- A local Git repository the operator controls, with an existing **base branch**, and an absolute path pointing to the *worktree root*. The source must be an ordinary non-bare Git repository; the checkout never needs to switch branches.
- A destination path inside **docs/** ending in .md. Hidden path components, traversals, symlink Git entries and Windows-reserved names are rejected. The target file must not have staged, unstaged or untracked edits.
- The operator supplies an exact GitHub OWNER/REPO label as a declaration. R40 does not look up, authenticate or compare this label with a GitHub remote because no remote operation occurs.
- A private Launchwright workspace and reviewed candidate. Imported/UNKNOWN technical evidence requires explicit acknowledgement and remains UNKNOWN; editorial review is separate from technical verification.

## Step 1: prepare a private plan (no writes)

```sh
node scripts/git-docs-pr.mjs plan \
  --state /private/launchwright-state \
  --repo-root /absolute/path/to/owned-git-project \
  --owner-repo OWNER/REPO \
  --base main \
  --docs-path docs/RELEASE_NOTES.md \
  --candidate CANDIDATE_ID \
  --artifact ARTIFACT_ID \
  --out /private/git-docs-plan.json \
  --acknowledge-draft-only \
  --acknowledge-unverified
```

The plan binds the exact local base branch SHA/tree, current destination content hash (if present), approved candidate digest, frozen artifact SHA-256 and source bytes, absolute repository identity represented only as a SHA-256, and a deterministic plan SHA-256. A plan is created **exclusively** (0600 on POSIX); its name cannot be overwritten. Nothing is fetched, modified, published or added to the Git object store during planning.

The `--acknowledge-unverified` flag is required if the candidate has technical state UNKNOWN. That flag **never** upgrades technical verification.

## Step 2: explicitly apply to a new local branch

Copy the three full hashes from the private plan; retype them explicitly:

```sh
node scripts/git-docs-pr.mjs apply \
  --state /private/launchwright-state \
  --repo-root /absolute/path/to/owned-git-project \
  --plan /private/git-docs-plan.json \
  --confirm-plan FULL_PLAN_SHA256 \
  --confirm-candidate FULL_CANDIDATE_SHA256 \
  --confirm-base FULL_GIT_COMMIT_SHA \
  --acknowledge-local-git-write
```

R40 writes a Git blob using `--no-filters`, a **separate temporary index**, `commit-tree` with the exact base parent, then compares the resulting commit against the frozen Markdown bytes and ensures the diff changes **only the one approved docs file**. Only after verifying it does it create a branch named `launchwright/docs-<plan-prefix>` with a compare-and-swap update-ref. Source checkout, HEAD, user index, and unrelated edited files are left untouched. No shell hooks, clean/smudge filters, external diff commands, or arbitrary project scripts are run.

If the same branch already exists, R40 verifies its exact base parent, path, blob SHA/size before treating it as a recoverable completed operation. Incompatible or manually modified branches fail **Conflict**, never overwrite. Source branch drift, candidate drift and uncommitted human changes at the target docs path fail closed. This is the only supported automatic recovery: reapply **the same private plan**, never generate a substitute after an ambiguous reply.

## Human review and remote publication remain separate

Use the returned local branch in your normal authorized Git workflow: inspect the diff, obtain reviewer approval, verify remote target/repo access, and **separately** push/create a GitHub draft PR using your own permissions and change-control rules. R40 makes no claim that this was done and has no code path for GitHub PR creation.

A safe dry-run review command on the owned repository is `git diff main...launchwright/docs-PLANPREFIX -- docs/RELEASE_NOTES.md` after separately verifying the base still matches.

## Acceptance and limits

The R40 tests use an actual disposable Git repository and real Launchwright Native SDK/SQLite candidate state. They exercise deterministic no-write plans, real branch/blob/commit creation, byte-for-byte Markdown readback, no current checkout/index modifications, exact idempotent recovery, rejected symlink entries and dangerous filenames, stale base, branch collision, human dirty target protection, missing review/technical acknowledgements, and the two-phase private CLI. Node 24 Linux/Windows/macOS CI is mandatory before acceptance; Node 22 local tests remain supplemental.

This is **local docs branch conformance** only: no external GitHub PR, GitHub authentication, remote review/merge, Platform job, customer-source execution or cross-tenant authority.

Accepted implementation source SHA `b69d17aafbb4badfd84d83205112244a994f02dc` passed Node24 Linux/Windows/macOS CI. Consult `evidence/r40/ci-runs.json` for exact job and non-authority boundaries. Remote GitHub live acceptance is not inferred.
