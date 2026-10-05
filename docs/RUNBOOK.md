# Operations runbook

All examples are designed to be repeatable by an operator who did not author the workspace.

## Diagnose without changing the machine

```sh
node src/main.mjs doctor --state .state
node scripts/verify.mjs
```

`doctor` reports runtime support and configured integrations. It does not install packages, browsers, Rust, drivers or privileged services.

## Lost application mutation response

For CLI mutations that may cross a failure boundary, prepare and save the exact request first.

```sh
node src/main.mjs prepare --state .state --operation entity.create --input input.json --out pending.json
node src/main.mjs send --state .state --prepared pending.json
```

If the caller loses the reply, **do not create a new request**.

```sh
node src/main.mjs recover --state .state --prepared pending.json
```

Recovery can return recorded, outcome_unknown or retention_expired. UNKNOWN is not permission to resend automatically.

## Platform request recovery

A Platform mutation is exported and persisted before its one network send. Recover the same Work record:

```sh
node src/main.mjs platform --state .state --work <work_id> --recover
```

Launchwright does not resend an outstanding unknown Platform mutation during recovery.

## Lost or ambiguous external channel acknowledgement

Do not prepare a second channel request after a timeout.

1. Keep the original ChannelAttempt and its logical request key.
2. The external adapter must have called `channel.claim` before its one send.
3. If the response was lost, call `channel.mark_unknown`; the participant becomes `UNKNOWN`.
4. Inspect the destination by a permitted external identifier or fingerprint.
5. Record that result with `channel.reconcile`.
6. Only a conclusive `NOT_FOUND` on a profile whose pinned idempotency policy allows it can enable an explicit retry. Create that retry with `retry_of` pointing to the latest attempt.

A transport acknowledgement is not proof of publication. `OBSERVED_PUBLISHED` requires a separately recorded observation source, timestamp and fingerprint. See `CHANNELS.md`.

## Withdrawal

Create a `channel.withdraw_plan` before a future adapter performs any withdrawal. The current implementation records scope/reason/replacement and the pinned channel capability only. It never claims that downstream caches, recipients or copies were deleted.

## Legacy history migration

A workspace created before the history extension must be migrated before the next mutation:

    node src/main.mjs migrate-history --state .state
    node src/main.mjs doctor --state .state

The migration records only the current entity revisions that actually exist. It does **not** reconstruct or infer older revisions. Run backup/export before migration when operating on valuable state.

## Workspace backup and restore

```sh
node src/main.mjs export --state .state --out backup.zip
sha256sum backup.zip

# Preview only
node src/main.mjs restore --bundle backup.zip --state .restored

# Commit only into an absent/empty destination
node src/main.mjs restore --bundle backup.zip --state .restored --commit
node src/main.mjs doctor --state .restored
```

The backup excludes credentials, the local session token, receipts and pending dispatch. Those omissions are intentional anti-replay boundaries. Restore rotates workspace generation.

## Candidate ZIP

From the UI, freeze a candidate and use **Export exact ZIP**. The resulting Bundle is `EXPORTED_NOT_DELIVERED`; downloading it does not create a private or external delivery receipt.

## Upgrade procedure

1. Keep a filesystem backup of the current workspace.
2. Fetch the exact Launchwright commit to be deployed.
3. Run `npm ci --ignore-scripts --no-audit --no-fund`.
4. Run `node scripts/verify.mjs`.
5. Run the light test suite.
6. Run CI on Node 24.21.0 and the affected heavy lanes.
7. Run `doctor` against the workspace before serving it.
8. If a future schema migration is required, use its explicit migration command; never replace an existing database with a demo seed.

No current command silently upgrades the SQLite schema.
