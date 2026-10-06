# Operations, usage and cost runbook

This runbook is for the application-side RS-OPS contract. It uses real Launchwright commands, but it does **not** turn Launchwright into a Platform scheduler, quota service, billing system or Driver Host.

## 1. Diagnose without mutation

Run:

```bash
node src/main.mjs doctor --state .state
```

`doctor` never installs dependencies, changes privileged system state, tests credentials, or opens a Platform connection. When Platform inputs are missing it reports the exact environment variables that must be supplied:

- `SEMWRIGHT_PLATFORM_SDK`
- `SEMWRIGHT_PLATFORM_LOCK`
- `SEMWRIGHT_PLATFORM_CONFIG`

A bearer credential is supplied separately as `SEMWRIGHT_PLATFORM_TOKEN` only when an actual Platform call is sent.

## 2. Prepare domain work

Create the work intent with the normal dispatcher:

```bash
node src/main.mjs call   --state .state   --operation work.prepare   --input work.json
```

Cost-bearing work cannot be sent merely because a local budget object exists. Platform-side enforcement must be explicitly configured and Launchwright must first hold one exact Platform reservation receipt.

## 3. Record the Platform reservation

Create `reservation.json` with the exact work ID, Platform reservation ID, receipt digest, compute source, hard ceilings and a bounded estimate. Then run:

```bash
node src/main.mjs call   --state .state   --operation usage.reserve_record   --input reservation.json
```

The logical reservation key and Platform reservation ID are idempotent. Repeating the exact receipt returns the existing record. Reusing either identity with different content fails closed.

The application distinguishes `platform-managed`, `byo` and `none`. A BYO compute receipt cannot claim Launchwright-managed compute charges.

## 4. Send exactly once

After the reservation is present:

```bash
node src/main.mjs platform --state .state --work <WORK_ID>
```

The durable pending request is committed before the external send. If the reply is lost, do **not** send again:

```bash
node src/main.mjs platform --state .state --work <WORK_ID> --recover
```

Recovery is observation/reconciliation, not a second execution.

## 5. Record measured usage

For each Platform ledger receipt, run:

```bash
node src/main.mjs call   --state .state   --operation usage.receipt_record   --input usage-receipt.json
```

A usage receipt binds:

- reservation and release;
- Platform job and ledger IDs;
- optional native receipt SHA-256;
- exact artifact IDs;
- usage category and compute source;
- measured billable/managed compute units, runtime, storage and egress.

Duplicate receipt IDs or Platform ledger IDs do not create a second logical usage entry. Different bytes under a reused identity are rejected.

## 6. Reconcile cancellation, failure or unknown outcome

If outcome is uncertain, first record that truth:

```bash
node src/main.mjs call   --state .state   --operation usage.finalize   --input usage-unknown.json
```

`OUTCOME_UNKNOWN` releases nothing and sets `RECONCILIATION_REQUIRED`. Preserve all measured consumption.

After Platform reconciliation, call `usage.finalize` again with the current reservation revision plus the exact adjustment ID and receipt digest. For a known final outcome, Launchwright records:

```text
released = max(0, reserved - measured_billable)
overrun  = max(0, measured_billable - reserved)
```

Only the unconsumed reservation is released. Cancellation never implies zero cost.

## 7. Inspect estimate, measurement and correlation

Run:

```bash
node src/main.mjs call   --state .state   --operation usage.inspect   --input usage-inspect.json
```

The report keeps estimated and measured usage separate and exposes the correlation chain:

```text
release -> work -> Platform reservation -> Platform job
        -> Platform ledger -> native receipt -> artifact
```

It also reports budget breaches and explicitly labels enforcement as externally required. Launchwright does not claim that a local ledger stopped an external process.

## 8. Performance measurements

Record query, admission, queue and render separately with `usage.performance_record`. The environment and exact code SHA are mandatory. Local-lab measurements are retained as lab evidence and are not eligible to become a production percentile claim.

## 9. Billing test callback

Only `mode: "test"` is accepted by `usage.billing_record`. The amount must equal finalized measured billable usage and the currency must match the reservation.

A duplicate callback returns the existing billing event. A failed callback:

- does not resend work;
- does not rerun render;
- does not modify technical evidence;
- does not perform a live charge.

No live payment provider is implemented by this contract.

## 10. Backup, restore and upgrade

Before an upgrade:

```bash
node src/main.mjs snapshot --state .state --out launchwright-backup.json
```

Restore only into a new workspace:

```bash
node src/main.mjs restore --snapshot launchwright-backup.json --state .restored
node src/main.mjs doctor --state .restored
```

Restore rotates workspace/request identity and suspends uncertain pending work. Historical mutation receipts are not reactivated. After an upgrade, run `doctor`, the light tests and the exact affected GitHub Actions lane before resuming external work.

## Acceptance boundary

Local tests establish application custody, idempotency, BYO accounting rules, phase separation, diagnostics and clean-room Platform loading. RS-E2E-28 still requires a real Platform test ledger, real quota/reservation behavior, a measurable cost-bearing job and a test invoice receipt on the exact candidate SHA.
