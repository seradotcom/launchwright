# Operator runbook

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

## Heavy acceptance

`Application checks` runs the supported Node runtime on Ubuntu, Windows and macOS. `Native and browser acceptance` is manually dispatched by affected lane:

- `browser`: installs Chromium only on the GitHub runner and exercises the real Launchwright UI.
- `native`: builds the pinned TypeScript SDK, bundles the bridge and compiles/tests the real Rust NativeDriver.
- `stress`: exercises bounded high-volume persistence, observation and portable restore without consuming workstation disk.

Always retain the exact run URL, SHA and artifact name in `ACCEPTANCE.md` after a successful run.

## Incident: lost mutation reply

Do not issue a replacement mutation. Recover the original request identity. In the browser, the pending request remains in localStorage until reconciliation. Platform-bound work also keeps its exported request before the one allowed send.

## Incident: uncertain external delivery

If a channel receipt is UNKNOWN and its profile is `recover-first` or `unsafe`, do not retry automatically. Query/reconcile the destination using its provider-defined recovery path, then record a new immutable outcome receipt.

## Legacy workspace history migration

Doctor reports the local schema and whether durable history is ready. A schema-v1 workspace stays readable, but mutations fail closed until the operator explicitly migrates it. Before migration, create an independent filesystem/snapshot backup appropriate to the existing version. Then run node src/main.mjs migrate-history --state .state followed by doctor.

The migration stores the current known revision for every entity and records NOT_RECONSTRUCTED for all earlier history. Do not infer missing revisions from audit events, receipts or external repositories.

## Usage, reservation and billing-test incidents

Use [OPS_RUNBOOK.md](OPS_RUNBOOK.md) for exact reservation-before-send, OUTCOME_UNKNOWN reconciliation, BYO accounting, performance phase recording and billing-test callback procedures. Those procedures preserve external Platform authority and never authorize a live charge.

## Backup/restore drill

Export a snapshot, restore into a fresh directory, confirm a new workspace generation/epoch, inspect `RESTORE_RECONCILE_REQUIRED` items, and only then resume normal mutations. Old request receipts are intentionally inactive.
