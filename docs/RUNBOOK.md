# Operator runbook

## R38 private local MCP operation and recovery

Launchwright's optional stdio MCP adapter is a **separate local process**
started by an authorized MCP client. Configure its explicit loopback --url,
private --token-file (0600) and --pending-dir (0700), using Node24. The owner
HTTP server must already be running. Never print or paste token contents,
or put them in tool arguments.

For changes: launchwright_prepare creates only a private intent; review the
returned original request_sha256 and intent_key before launchwright_submit.
A lost acknowledgement or uncertain result must be handled with
launchwright_recover **using the same key**, never a substitute intent or
blind retry. The private journal persists until receipt reconciliation;
do not delete it as a shortcut. Publishing/approval tools are not exposed.
If the client cannot authenticate, check the locally owned token file,
loopback URL, and file modes. Never expose stdio transport as a public
HTTP service or claim ChatGPT host acceptance from a local inspector.


## R36 filesystem capacity preflight

Use node src/main.mjs doctor --state <DIR> before importing or rendering
artifacts. The report distinguishes process-temporary space from workspace
space. Free space below 16 MiB reports BLOCKED; below 256 MiB reports
ATTENTION. If the host temporary volume is exhausted but the workspace has
capacity, select a private TMPDIR on an adequately provisioned filesystem
(POSIX) and re-run doctor. Do not delete unknown files, worktrees, CI
receipts, customer data or unrelated caches to make tests pass. Doctor never
performs automatic cleanup, migrations or Native/Host acceptance.


## Before changing the application

1. Confirm the Semwright pin in `SOURCE_LOCK.json` still matches the intended upstream snapshot.
2. Keep local checks lightweight; the workstation has limited free storage.
3. Never treat an old GitHub Actions PASS as evidence for a new SHA.

## Local checks

```sh
npm test
node scripts/verify.mjs
node src/main.mjs doctor --state .state
git diff --check
```

Node 24.21.x is the acceptance runtime. Another local Node version is diagnostic only.

`doctor` never installs, repairs or migrates automatically. It reports unsafe local file permissions, missing/changed Native SDK pins, schema/history state and outstanding intents with remediation text. For an independent reproduction of the documented lifecycle, run `node scripts/clean-room.mjs`; CI records the same report on all three supported runner OSes.

## Heavy acceptance

`Application checks` runs the supported Node runtime on Ubuntu, Windows and macOS. `Native and browser acceptance` is manually dispatched by affected lane:

- `browser`: installs Chromium only on the GitHub runner and exercises the real Launchwright UI.
- `native`: builds the pinned TypeScript SDK, bundles all nine bridge profiles, compiles/tests the real Rust NativeDriver, checks the pinned `semwright-project-graph` contract at the same Semwright SHA and runs the per-profile bridge smoke. Do not move these Cargo/dependency builds to the storage-constrained workstation.
- `stress`: exercises bounded high-volume persistence, observation and portable restore without consuming workstation disk.

Always retain the exact run URL, SHA and artifact name in `ACCEPTANCE.md` after a successful run.

## Usage and billing projection

`usage.reserve` is application-side preflight only: it may not exceed the work budget, but it does not reserve money or capacity in Semwright Platform. `usage.record` retains provider observations idempotently by source/event ID, including externally observed overruns. `usage.adjust` finalizes or corrects the application projection from explicit measured receipt IDs. `usage.inspect` keeps estimate, measured usage, reservation, accounted charge and overruns separate. `billing.test_callback` is permanently test-only and never retries render work or mutates evidence. Reconcile all of these records against canonical Platform ledger/billing receipts before making any financial claim.

## Incident: lost mutation reply

Do not issue a replacement mutation. Recover the original request identity. In the browser, the pending request remains in localStorage until reconciliation. Platform-bound work also keeps its exported request before the one allowed send.

## Incident: uncertain external delivery

If a channel receipt is UNKNOWN and its profile is `recover-first` or `unsafe`, do not retry automatically. Query/reconcile the destination using its provider-defined recovery path, then record a new immutable outcome receipt.

## Legacy workspace history migration

Doctor reports the local schema and whether durable history is ready. A schema-v1 workspace stays readable, but mutations fail closed until the operator explicitly migrates it. Before migration, create an independent filesystem/snapshot backup appropriate to the existing version. Then run node src/main.mjs migrate-history --state .state followed by doctor.

The migration stores the current known revision for every entity and records NOT_RECONSTRUCTED for all earlier history. Do not infer missing revisions from audit events, receipts or external repositories.

## Backup/restore drill

Export a snapshot, restore into a fresh directory, confirm a new workspace generation/epoch, inspect `RESTORE_RECONCILE_REQUIRED` items, and only then resume normal mutations. Old request receipts are intentionally inactive.
