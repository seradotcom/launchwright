# R41 — Exact GitHub DRAFT PR after operator-pushed Git docs branch

R41 builds on R40's **locally prepared Git docs branch**, not on an arbitrary file or AI-generated Git command. It introduces an explicitly approved **GitHub Pull Request in DRAFT state** through the authenticated operator's GitHub CLI. It deliberately NEVER pushes Git branches, merges Pull Requests, edits existing remote PR content, publishes a website or creates a Semwright Platform job.

## Operator-controlled sequence

First complete the [R40 Git docs branch workflow](GIT_DOCS_BRANCH.md). Its local branch must have an exact frozen Markdown source, current base commit/tree, editorial-approved candidate, and one-file diff. Independently review that local branch; if the operator approves, **manually push** it to the intended GitHub repository, with the correct owner credentials, Git remote verification and change management. The R41 server does not run Git push or possess a Git credential helper.

Then prepare an immutable private DRAFT intent:

```sh
node scripts/git-docs-draft-pr.mjs plan \
  --state /private/launchwright-state \
  --repo-root /absolute/owned-git-project \
  --branch-plan /private/git-docs-plan.json \
  --title "Review these release notes" \
  --note "Operator editorial context" \
  --out /private/git-docs-draft-pr-intent.json \
  --acknowledge-draft-only
```

The plan must read back and verify the exact R40 local branch, base SHA, commit parent, target file SHA-256, candidate and artifact pins. It records the intended title and complete body **before any GitHub request**. No GitHub API is contacted during planning.

After independently confirming that the local branch was manually pushed to the correct authorized GitHub repository, explicitly send:

```sh
node scripts/git-docs-draft-pr.mjs send \
  --state /private/launchwright-state \
  --repo-root /absolute/owned-git-project \
  --branch-plan /private/git-docs-plan.json \
  --intent /private/git-docs-draft-pr-intent.json \
  --confirm-repo OWNER/REPO \
  --confirm-branch-plan FULL_R40_PLAN_SHA256 \
  --confirm-commit FULL_LOCAL_GIT_SHA \
  --acknowledge-first-send \
  --out /private/git-docs-draft-pr-receipt.json
```

The GH CLI must be installed and authenticated by the operator. The adapter restricts GH_HOST to github.com. It reads the current remote base and head branch SHAs; **both must match the exact approved local plan**. It checks all historical PRs for the same exact head/base so an already closed/merged PR cannot be silently replaced with a new one. It creates a remote PR only using GitHub's Draft flag, then re-reads it and requires exact title, complete Markdown body, DRAFT state, open lifecycle, owner/head/base identities, both full commit SHAs and trusted github.com URL. Every readback is validated; no existing PR can be overwritten.

## Lost response / unknown outcome

If the first-send CLI exits with an unavailable or ambiguous result, **do not resend**. Use the exact private R41 intent:

```sh
node scripts/git-docs-draft-pr.mjs recover \
  --state /private/launchwright-state \
  --repo-root /absolute/owned-git-project \
  --branch-plan /private/git-docs-plan.json \
  --intent /private/git-docs-draft-pr-intent.json \
  --confirm-repo OWNER/REPO \
  --confirm-branch-plan FULL_R40_PLAN_SHA256 \
  --confirm-commit FULL_LOCAL_GIT_SHA \
  --out /private/git-docs-draft-pr-recovered-receipt.json
```

Recovery only reads the remote GitHub base/head and the exact historical PR. If absent, recover-only fails **NotFound**; it never pushes, creates, merges or retries the mutation. If altered or closed, it fails **Conflict**; it never clobbers user edits. The operator may reconcile the branch manually and prepare a new reviewed intent, but no automatic new send occurs.

Receipts have explicit `published:false`, `approved_merge_performed:false`, `platform_authority:false`, and `customer_acceptance:false`. A GitHub Draft PR is only a request for human review, **not an application or website publication**.

## Evidence and limits

Synthetic tests use actual Launchwright SQLite/Native SDK frozen candidate state, Git commit/tree/blob readback from real disposable Git repositories, and a deterministic injected GitHub transport. Negative controls cover missing pushed remote branch, moved base SHA, false send consent, lost API acknowledgement, exact recovery without duplicate PRs, changed title/body/URL/refs/fork identity, closed PRs and tampered saved intents. The GH adapter itself is asserted to send only bounded GET reads and Draft POST requests.

**No live GitHub Draft PR was created as part of this test**, and this integration cannot establish operator account authentication, external reviewer approval, website deployment, real customer source rights or Semwright Platform Publish. The original master DOCS_GIT profile is **PARTIAL** until independently accepted external draft creation/review and output delivery are proved.
