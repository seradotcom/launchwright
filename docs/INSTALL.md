# Install and first run

Launchwright is a local-first developer preview. The supported runtime for the pinned Semwright Native SDK is **Node 24.21.0 through Node 24.x**.

## Requirements

- Node >=24.21.0 <25
- npm
- Git for source installs
- No browser, Rust toolchain or renderer is required for the local editorial workspace

Do not run dependency install scripts for this repository. The Native SDK is vendored as a byte-pinned package.

```sh
npm ci --ignore-scripts --no-audit --no-fund
node scripts/verify.mjs
node src/main.mjs init --state .state
node src/main.mjs doctor --state .state
node src/main.mjs serve --state .state --port 4317
```

Open `http://127.0.0.1:4317`. The service is loopback-only. Read the local token from `.state/session-token`; never place it in a URL, source file or exported package.

## Portable workspace transfer

Export produces a verified ZIP. It excludes the session token, mutation receipts and outstanding dispatch records.

```sh
node src/main.mjs export --state .state --out launchwright-workspace.zip
node src/main.mjs restore --bundle launchwright-workspace.zip --state .state-restored
node src/main.mjs restore --bundle launchwright-workspace.zip --state .state-restored --commit
node src/main.mjs doctor --state .state-restored
```

The first restore command is a dry run. Commit requires an absent or empty destination. Restored domain identities are preserved, while the workspace generation is rotated so old optimistic-concurrency and request identities cannot be replayed.

## Heavy acceptance

Do not install Chromium or compile Rust on constrained workstations merely to check the local editor. GitHub Actions provides the supported-engine and native/browser lanes:

```sh
gh workflow run ci.yml --ref <branch>
gh workflow run heavy.yml --ref <branch> -f lane=all
```

A green application test does not establish canonical Driver Host acceptance, product capture, Composition rendering or external publication.
