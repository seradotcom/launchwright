# Public HTTP, client and event contract

Launchwright exposes a loopback HTTP surface over the same `LaunchwrightApplication` dispatcher used by the CLI and Native SDK profiles. The HTTP server is not a second application backend and does not add Platform, Driver Host, Graph, Composition or Publish authority.

## Discovery first

After local-session authentication, a client should call:

```text
GET /api/v1/discovery
```

The response identifies the Launchwright and Native SDK versions, current workspace version, exact application operations/scopes, public route names, observation resource, event snapshot behavior and authority boundaries. It contains no session token or inferred external capability.

The browser client performs discovery before inventory observation on every fresh/reloaded session. The exported `LaunchwrightClient` provides `discovery()` for other clients.

## Public client package and compatibility

`client/` is independently packable as `@launchwright/client`. Its package contains only `index.mjs` plus package metadata; it has no application, SQLite, Native SDK, or private repository imports. A clean-room regression packs that directory, installs the tarball in a fresh temporary project and uses only the documented HTTP contract to discover, create and read a Product.

Discovery now carries an explicit `api.version`, discovery schema, prepared-request schema and event-page schema. The client validates those values before use and can require named operations. A client that supports another discovery schema/API or asks for an unavailable operation receives `Unsupported`; it must not reinterpret newer data as an older contract. This is local public-client compatibility evidence, not publication to a package registry or external host acceptance.

## Resource observation

`POST /api/v1/observe` uses the canonical application observation provider. Its cursor is bound to the exact workspace version observed on the first page. A workspace mutation makes a prior observation cursor stale; the client must restart instead of mixing revisions.

## Durable event snapshots

`POST /api/v1/events` reads the append-only application mutation journal. The first page establishes an integer `watermark`, and every continuation must reuse that watermark.

A page contains:

- `schema_version: launchwright-event-page/2`;
- ordered event envelopes up to the fixed watermark;
- `next_after` when another page exists inside that snapshot;
- the workspace generation and event watermark used for the snapshot.

Each `launchwright-event/2` envelope has a durable event ID and sequence, source, workspace generation, operation, principal, affected resource when available, committed workspace revision, occurrence time and request cause. New commits after the first page are intentionally excluded from that snapshot and appear only in a fresh read. A cursor beyond its watermark or a watermark ahead of the durable journal fails closed as `StaleReference`.

The public client exposes `events()` and `eventPages()`; the latter carries the first watermark through every page.

## Mutation and recovery

The public HTTP mutation flow remains two-phase:

1. `POST /api/v1/prepare` creates an exact request envelope bound to operation, input, expected workspace revision, epoch and caller-provided idempotency key. Preparation has no durable effect.
2. The caller durably stores that prepared intent before `POST /api/v1/invoke`.
3. A confirmed reply may clear the caller's pending record.
4. If the reply is lost, `POST /api/v1/recover` checks the original request identity. The client must not synthesize a replacement intent.

SQLite commits the domain mutation, durable receipt and audit event in one transaction. Repeating the identical request identity returns the recorded result and does not append a second event. Reusing that identity for another body or principal conflicts.

## Mobile import boundary

Filesystem package ingestion is intentionally **not** an HTTP or Native bridge feature. The local CLI validates a non-symlink package root, path containment, asset budgets, exact hashes and PNG/JPEG/MP4 container dimensions, then stages exact bytes in the application content-addressed store. Only after that step does it invoke the normal `mobile.import` mutation with a bounded manifest; no local path is retained in domain state.

`mobile.import` is a capture-scoped canonical operation for pre-staged hashes. It records imported/unverified evidence and immutable artifact resources, never native observation. `mobile.inspect` is read-only and is available through `POST /api/v1/read` and `LaunchwrightClient.mobileInspect(id)`; it rechecks bytes, source/target/build pins and rights state. Actual Android/iOS runner or device capture remains outside this application contract.

See [Mobile import contract](MOBILE_IMPORT.md) for the package schema and limits.

Godot source execution is likewise not an HTTP shell. `profile.preflight` exposes only the pinned compatibility/readiness contract; the real Godot driver and engine remain Semwright-owned runtime boundaries. See [Godot source profile](GODOT_SOURCE.md).

## Deep links

The browser accepts `#<section>/<resource-id>` for resource-backed inspection state such as an exact review candidate. Reloading a deep link repeats discovery and read-only observation, then reopens the same registered resource. It does not invoke a mutation and it carries no token, credential, approval or execution authority.

`LaunchwrightClient.deepLink(section,id)` constructs the same URL form for plugin/client continuity. The link is navigation only; host/plugin acceptance remains integration-dependent.

## Security boundary

The server remains loopback-only, rejects query parameters, bounds JSON bodies, validates Host/Origin/fetch-site, uses an HttpOnly SameSite session cookie, rejects unexpected routes and serves CSP-constrained static assets. Artifact and channel-bundle downloads recheck authenticated access and content-addressed bytes.

This document describes the public application contract only. Real remote tenancy, shared approvals, external event transport, ChatGPT Plugin host acceptance and cross-account Platform execution remain outside current acceptance.
