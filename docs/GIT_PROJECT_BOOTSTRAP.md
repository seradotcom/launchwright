# R35 — Existing Git project bootstrap

R35 connects the read-only R32 Git observer and R33 editorial outline generator into a **two-phase operator-controlled local onboarding workflow**. It creates six Launchwright resources, but grants no Semwright Project Graph, Driver Host, Platform, customer, or publication authority.

## Input and operator trust boundary

Start with an initialized Launchwright workspace and an exact, private R32 observation JSON made from two full, pinned Git commit SHAs. The operator explicitly chooses a product and release name, approved source name/purpose, target name, editorial document title, locale, role, plan, region, and rights as owned or licensed. Rights and approval are **operator declarations**, not independent certification.

The target uses a **declared** 1440×900 viewport at scale 1.0, empty flags and the selected locale for UI and editorial. These are not observed device settings.

## Step 1: plan (no workspace mutations)

Create the original observation from an existing owned local repository using the R32 procedure in [Git change sources](GIT_CHANGE_SOURCE.md):

```sh
node scripts/git-change-source.mjs observe \
  --repo /absolute/path/to/owned/repository \
  --alias owned_project \
  --base FULL_40_CHARACTER_BASE_COMMIT \
  --head FULL_40_CHARACTER_HEAD_COMMIT \
  --out /private/owned-project-observation.json
```

Create a digest-bound onboarding plan:

```sh
node scripts/git-project-bootstrap.mjs plan \
  --in /private/owned-project-observation.json \
  --out /private/owned-project-bootstrap.json \
  --product "My existing product" \
  --release "Release candidate" \
  --source-name "Approved Git project" \
  --target "Desktop reviewer" \
  --notes-title "Changes to review" \
  --purpose "Local owner-approved committed Git metadata" \
  --locale en-US \
  --role reviewer \
  --plan-label local \
  --region MX \
  --rights owned
```

The private plan is created exclusively (mode 0600 on POSIX) and contains commit/tree SHA identities, changed-path **counts** and operator-selected names. The absolute Git path and source filenames are omitted. It is not an external Git send or an application mutation.

## Step 2: apply with exact confirmations

Read the saved plan's `plan_sha256` and `head_sha`, then independently confirm both and all four operator declarations:

```sh
node scripts/git-project-bootstrap.mjs apply \
  --state .state \
  --in /private/owned-project-observation.json \
  --plan-file /private/owned-project-bootstrap.json \
  --confirm-plan EXACT_64_CHARACTER_PLAN_SHA256 \
  --confirm-head FULL_40_CHARACTER_HEAD_COMMIT \
  --approve-source \
  --declare-rights \
  --acknowledge-imported \
  --acknowledge-editorial-draft
```

The canonical Semwright Native SDK application dispatcher creates (or safely reuses) six **local** resources: Product, draft Release pinned to the Git head commit, approved CLI Source, Target, imported Git Evidence, and human-editable Markdown Deliverable. The evidence is always `imported-declaration / technical: UNKNOWN / host_acceptance: NOT_ESTABLISHED`. The document is a source-linked factual file-count inventory, **not verified product functionality**.

The user must still review/edit notes, obtain appropriate runtime/capture proof, render, freeze a candidate, collect approval and separately select a delivery channel. No GitHub release or public publication is created here.

## Recovery, conflicts and concurrency

Every local resource uses the existing Native SDK transaction. If a process crashes after creating some resources, rerunning the **same unchanged private plan** reconciles exact existing resources and creates only missing ones. Conflicting product names, mismatched source alias or rights, edited release/source, duplicate evidence or human-modified Markdown fail closed; no overwrite occurs.

The CLI uses an exclusive private `.git-bootstrap-apply.lock` within the workspace. Parallel imports fail. If a process was killed abnormally, first verify it is no longer running **before manually clearing the stale lock**. The workflow never auto-deletes unknown locks or retries remote mutations.

## Explicit limits

This adapter does not fetch Git remotes, execute product scripts, read diffs/commit messages, validate rights or feature truth, create Platform jobs, infer tenant/customer acceptance, or upgrade Git metadata to Project Graph, Driver Host, or publication authority. The saved plan SHA-256 provides byte-binding, not an external signer identity.

Supported-engine CI must validate disposable local Git fixtures and actual Native SDK/SQLite bootstrap, partial-failure recovery, operator-denial or tampering, source drift and exclusive locking on Node 24 Linux, Windows and macOS. Any Node 22 run is supplemental.
