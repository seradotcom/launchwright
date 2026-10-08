# R32 — Read-only Git change sources for existing projects

Launchwright can inspect committed changes in an **existing local Git project**,
including projects that were not initially developed with Semwright. The
operator owns the repository and approves the import.

This adapter **does not** replace the Semwright Project Graph, create
canonical source observations, run any project code, or fetch from remote.
Its results are explicitly imported evidence with technical state UNKNOWN.

## Contract and reproducibility

- Requires an explicit *absolute root directory* of an existing working tree.
  Passing a nested directory is refused.
- Requires **two full lowercase 40-character commit SHAs**. The base must
  be an ancestor of the head. Tag names, branch names and moving HEAD are
  deliberately not accepted.
- Uses only read-only Git commands: rev-parse, cat-file, merge-base, rev-list
  and diff --name-status. No checkout, reset, fetch, pull, submodule update,
  external diff, textconv, hooks or arbitrary commands from the repo are run.
- Reads the commit/tree identities, bounded commit count and file name/status
  metadata. It **does not read file contents, diff hunks or commit messages**.
  It rejects unsafe/non-UTF-8 changed file paths and more than 512 changed
  paths rather than silently truncating an inventory.
- The portable JSON has a canonical Native SDK digest of all its fields,
  changed path manifest, input revisions and explicit non-authority markers.
  It does **not** embed the private absolute local filesystem path.
- Paths and project metadata may still be sensitive; observation files must
  remain private. There is no automatic secret/PII classification.

## Observe an existing Git project

```sh
node scripts/git-change-source.mjs observe \
  --repo /absolute/path/to/repository \
  --alias product_source \
  --base 0123456789abcdef0123456789abcdef01234567 \
  --head 89abcdef0123456789abcdef0123456789abcdef \
  --out /private/git-observation.json
```

The command never connects to a remote service or changes the repository.
The output file is exclusively created, with mode 0600 on POSIX.
Its source alias is a stable local identifier, not an execution grant.

## Attach it to an approved Launchwright release

Create the normal editable resources inside Launchwright first:

- A **release** with build equal to the exact observation head SHA.
- A **source** of type CLI with `locator: "git-local:product_source"`,
  `build: HEAD_SHA`, approved purpose and
  `approval: "approved"`. This is still a *declared* source profile,
  not an observed native source.
- A target belonging to that release.

Then explicitly record the saved observation:

```sh
node scripts/git-change-source.mjs record \
  --state .state \
  --in /private/git-observation.json \
  --source source_UUID \
  --release release_UUID \
  --target target_UUID \
  --name "Committed changes for v1" \
  --rights owned \
  --acknowledge-imported
```

Choose owned or licensed only when the repository operator has verified the
rights. This is an operator declaration, not rights certification.

The adapter verifies the saved JSON digest, source alias, approved purpose,
exact head SHA build, target/release/product scope and explicit acknowledgement,
then invokes the existing canonical Native SDK `evidence.import`
transaction. It does **not** invent a new Git automation driver or new
Project Graph traversal kernel.

The stored evidence has `admission: imported-declaration`,
`technical: UNKNOWN`,
`host_acceptance: NOT_ESTABLISHED`, and
`rights_basis: operator-declaration`. This useful provenance can
inform reviewed release documentation, but cannot by itself satisfy
canonical capture, claim truth, dependency freshness or execution tests.

## Safety and acceptance

- Local Git metadata may still include confidential file paths. Never
  auto-publish observation JSON. Use reviewed summaries and source links.
- An observed local Git diff is **not** proof that a binary was built, a
  product ran, a screenshot was captured, a user flow passed, or a feature
  is available in production.
- This source adapter does not imply Semwright Platform job/tenant authority,
  external customer acceptance, GitHub access, publication or billing.
- CI tests create disposable owned Git fixtures with real commits and
  changes, verify stable summaries, reject mismatched SHAs/scope/tampering,
  and import only through the existing SQLite/Native SDK dispatcher.
  This is **operator-local acceptance**, not Driver Host isolation.

Future canonical project extraction and dependency/impact observations
remain owned by Semwright's Project Graph and native drivers.
