# Operations, metering and cost projection

Launchwright records enough application-side state to reconcile a release workflow with Semwright Platform without pretending to be the Platform ledger, scheduler, billing system or executor.

## Authority boundary

The following Launchwright records are projections:

- `work`: a durable intent and send/recovery state for an owner-supplied Platform client.
- `usage_reservation`: an application preflight reservation bounded by the work budget.
- `usage_receipt`: an immutable provider observation, deduplicated by source plus provider event ID.
- `usage_adjustment`: an immutable finalization/correction whose charge is derived from explicit measured receipt IDs.
- `billing_test_receipt`: an authorized test-mode callback record only.

None of those records debit an account, reserve worker capacity, establish Platform admission, stop a remote executor or turn a local observation into canonical technical evidence.

## Reservation and reconciliation

1. Create `work` with an explicit maximum cost, currency and runtime ceiling.
2. Call `usage.reserve` before execution. The reservation may not exceed the work cost ceiling.
3. Dispatch the work through the canonical Platform adapter. Launchwright persists the prepared request before the one allowed send.
4. Ingest provider usage using `usage.record`.
5. Finalize with `usage.adjust` using the exact measured receipt IDs that form the accounting basis.
6. If Platform supplies a correction, ingest the corrected receipt and create another `usage.adjust` that explicitly replaces the latest adjustment.
7. Use `usage.inspect` for reconciliation; use the canonical Platform ledger/billing surfaces for financial truth.

Duplicate provider event delivery is harmless when the source, provider event ID and normalized payload are identical. Reusing the same event ID with different data is a conflict.

## Estimated, measured and BYO cost

Every reservation has an estimate. Provider observations declare whether they are `estimated` or `measured`. `usage.inspect` reports those values separately and never relabels an estimate as measurement.

Cost is decomposed into:

- total microunits;
- Platform-owned compute microunits;
- service microunits;
- currency.

For `byo` and `unknown` compute origins, Platform-owned compute cost must be zero. Service cost can still be represented. This prevents a Launchwright projection from charging a user's own compute as if it were managed Platform compute.

## Overruns and limits

Preflight reservations above the requested work ceiling fail closed. External measurements are not discarded merely because they show a violation. If an executor reports more cost or runtime than requested, Launchwright preserves the receipt and `usage.inspect` marks the observed cost/runtime overrun.

The projection exposes `runtime_stop_authority=false` and `executor_enforcement=external-platform-required`. A real hard-stop claim therefore requires evidence from the executor/Platform that owns the job.

## Correlation and evidence

A usage receipt may bind:

- the Launchwright release and work IDs;
- the exact Platform job ID already stored on that work;
- a native receipt SHA-256;
- a Launchwright artifact ID and its stored SHA-256.

A mismatched Platform job or cross-release artifact is rejected. Usage correlation never promotes the receipt into technical PASS; `technical_evidence_admitted` remains false.

## Billing test callback

`billing.test_callback` accepts only `accepted` or `failed` test outcomes and always stores:

- `mode=test`;
- `external_charge=false`;
- `render_retry_triggered=false`;
- `evidence_mutated=false`;
- `billing_authority=false`.

The callback operation requires the `admin` scope. It is designed to prove retry/idempotency boundaries without live charging.

## Acceptance boundary

Local tests can establish application invariants: idempotency, reservation ceilings, correction history, BYO classification, correlation, overrun visibility and no work/evidence replay from billing callbacks.

They cannot establish canonical Platform admission, worker-side hard stops, production metering, real invoices, webhook delivery from a billing provider or charge correctness. Those require an owner-configured Semwright Platform environment and exact external receipts.
