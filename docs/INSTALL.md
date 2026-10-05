# Install and local operation

Launchwright is a local-first developer preview built on Semwright Native SDK 0.9.0-dev.1.

## Supported runtime

Use Node 24.21.x. The repository declares `>=24.21.0 <25`; results from other Node versions are supplemental only.

```sh
npm ci --ignore-scripts --no-audit --no-fund
node src/main.mjs init --state .state
node src/main.mjs serve --state .state --port 4317
```

The server binds loopback only. Read the generated `.state/session-token` locally and enter it in the login screen. Do not put that token in a URL, git, screenshots, release packages or automation logs.

## Empty and synthetic workspaces

`init` creates an empty workspace. `demo` adds only synthetic editorial data and does not represent native product capture.

```sh
node src/main.mjs demo --state .state
node src/main.mjs doctor --state .state
```

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
