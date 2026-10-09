# Installation / operator entry

Read docs/INSTALL.md for full steps and requirements. This file fulfills
the master handoff path without duplicating or silently redefining the
canonical operator guide.

Required: supported Node 24.21.x, exact Semwright Native SDK 1.0.0 lock,
authorization to the local workspace and sufficient temporary/storage
capacity. The application can run its **local owner** loopback
interface and public Client SDK, but it is not a verified remotely
deployed multi-tenant Platform service.

Quick start:

```sh
npm ci --ignore-scripts --no-audit --no-fund
node src/main.mjs init --state .state
node src/main.mjs doctor --state .state
node src/main.mjs serve --state .state --port 4317
```

Open http://127.0.0.1:4317 and unlock with the locally owned private
session-token file. Do not publish or paste the token.

Optional local MCP: docs/MCP_LOCAL.md. Git source onboarding:
docs/GIT_ONBOARDING_UI.md. Source ZIP backup and tests: VERIFY.md.
Restore/migration: MIGRATION.md. Unimplemented or external capabilities:
KNOWN_LIMITS.md and CAPABILITY_MATRIX.md.
