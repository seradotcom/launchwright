# R38 — Local MCP entry through the public Client SDK

Launchwright now has a **standard MCP stdio server for a local owner's already-running workspace**. This is an *adapter* using the official pinned MCP TypeScript SDK and `client/index.mjs`; it does not create a second Native SDK, app database, Broker, scheduler, Publish service or agent framework.

It proves that an **independent MCP client process** can discover, read and edit the same Release/Claim resources as the browser and public HTTP client. It does **not** establish that this MCP server has been installed, authenticated or accepted in the ChatGPT Plugin host. The host/Plugin interoperability gate remains external until tested there.

## Prerequisites

- A supported Node 24.21.x runtime.
- The local Launchwright workspace initialized and its loopback service running. Follow `docs/INSTALL.md`.
- The owner session token file created by Launchwright, normally `/absolute/path/to/.state/session-token`; it must be a regular private file with mode 0600 on POSIX.
- An operator-chosen private directory for pending MCP intent custody, mode 0700 on POSIX. The adapter can create that **one** directory, but it never initializes/migrates the workspace.

No token should appear in the MCP tool arguments, source code, screenshots, copied prompts, JSON observations or shell command text. Use only a **token-file path** in the MCP server configuration; the adapter reads the token from that private file and does not print it.

## MCP client command

Configure your local MCP-capable client to launch this stdio process:

```sh
node /absolute/path/to/Launchwright/scripts/mcp-local.mjs \
  --url http://127.0.0.1:4317 \
  --token-file /absolute/path/to/.state/session-token \
  --pending-dir /absolute/path/to/.state/mcp-pending
```

The owner local HTTP service must already be running. Both connection and mutation authority remain limited to that local service: HTTPS URLs, non-loopback hosts, URL path/query credentials and unknown ports are rejected. The MCP server does not create an app owner cookie, bypass app scopes or import Native SDK/SQLite internals.

The process uses stdin/stdout exclusively for JSON-RPC MCP messages. Do not pipe logs or prompts into that stdout. It is for an already trusted **local MCP host**, not a publicly exposed remote server.

## Tools and capabilities

Read-only tools:

- `launchwright_describe` — source-reported capabilities, not proof of Platform connection.
- `launchwright_list` — explicit bounded 1–24 item workspace page with cursor.
- `launchwright_get` — exact single resource, requiring a returned resource ID.
- `launchwright_impact` — registered impact and coverage gaps for a release.
- `launchwright_candidate` — exact candidate review/verifier gate readback.
- `launchwright_history` — bounded committed domain event cursor.
- `launchwright_channel` — channel package/outcome state; PACKAGE_READY is not PUBLISHED.

Two-phase mutation and recovery:

- `launchwright_prepare` — accepts only explicitly selected *local* actions: entity create/update, change proposal, impact plan, deliverable text render, candidate freeze, or Platform **intent preparation** (not execution). It creates an exact prepared request, saves it to a private pending journal with mode 0600 and returns the intent key plus SHA-256. No application mutation is performed by this tool.
- `launchwright_submit` — requires the **same original** intent key and request digest plus a true acknowledgement flag, re-reads the private prepared bytes and sends through the public Client SDK. It clears the file only after a bounded successful reply. This tool never automatically resends a lost outcome.
- `launchwright_recover` — looks up the original pending request by key through the public Client SDK's recovery operation, **without resubmission**, clearing custody only on a recorded result.

Approval, candidate review decisions, channel upload/publish, arbitrary SDK operations, arbitrary subprocesses/Git paths, user-provided auth tokens and cross-tenant identity grants are **not exposed** by this MCP tool set. The existing Launchwright UI remains the place to record editorial decisions and channel authorizations.

Each MCP response is bounded to 24 KiB; large inventories must use paging. Unrecognized operations and large/malformed inputs return explicit errors rather than silently truncating the resource denominator.

## Example independent workflow

1. Call `launchwright_describe`, then `launchwright_list` and collect real product/release IDs.
2. Read the current Release via `launchwright_get` and its exact revision. Prepare an edit with `launchwright_prepare` for `entity.update`; the proposed data and version are still checked by Launchwright.
3. Review the returned immutable request SHA-256, confirm the same key/digest and deliberately call `launchwright_submit`.
4. If the response was lost, **do not prepare a replacement**: call `launchwright_recover` with the same key. An unknown/not-recorded result remains in the private journal for deliberate operator resolution.
5. The browser/HTTP client sees the same resource and revision. Historical events and impact can be read through MCP or the web UI; no parallel domain state exists.

## Authorization, limitations and receipts

- The token file represents the **local owner**, not a remote tenant or delegated reviewer. Do not point an untrusted MCP host at it.
- The pending journal is not a second application database; it contains only in-flight public SDK prepared envelopes for exact idempotent recovery. Manual deletion after a crash must be preceded by operator reconciliation.
- A successful MCP request may record a local domain intent. It cannot approve technical truth, execute upstream Platform jobs, publish a GitHub release, establish customer capture or prove a feature claim.
- R38's acceptance runs use a real official MCP Client process connected to a separate stdio server and an authenticated Launchwright loopback HTTP service. That service uses the canonical Semwright Native SDK dispatcher and a real SQLite-backed owned fixture. The same Release is read/edited through both public HTTP and MCP clients.
- Unsupported external host acceptance (ChatGPT MCP/Plugin installation), remote OAuth, multi-user reviewer/team tenancy, Semwright Platform Publish and real customer product acceptance remain **separate** and are not marked PASS.

The production dependency lock pins `@modelcontextprotocol/sdk@1.32.1` and `zod@3.25.76`. The earlier MCP SDK 1.29.0 was rejected after `npm audit` flagged a high-severity OAuth issue; a patched 1.32.1 audit must pass before R38 acceptance. No external OAuth features of the MCP SDK are used by this adapter.
