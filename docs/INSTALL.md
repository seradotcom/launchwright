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
