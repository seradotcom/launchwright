# Channel delivery lifecycle

Launchwright treats package creation, transport acceptance, destination observation, and withdrawal as different facts. The local browser can prepare an intent and record an operator reconciliation, but it does not contain a hidden publisher.

## ChannelProfile

A ChannelProfile is an editable, versioned product resource. A candidate pins the exact resource version. The profile records the channel kind, delivery mode, accepted formats/locales, artifact byte limit, idempotency strategy, withdrawal capability, provenance, and review timestamp.

Changing a pinned profile makes the candidate stale. A delivery attempt cannot be claimed when the candidate or profile has changed.

Profiles with `delivery_mode=export` never create a ChannelAttempt. Use `candidate.export_bundle`; the resulting Bundle is `EXPORTED_NOT_DELIVERED`.

## DeliveryAttempt

`channel.prepare` creates a durable ChannelAttempt only after the candidate is fresh, the required review dimensions are approved, and every artifact fits the pinned profile. A stable logical key prevents a second attempt from being created accidentally.

The application uses these externally meaningful states:

- `PREPARED`: exact candidate/profile/logical request recorded; nothing sent.
- `SENT`: transport accepted a request, but availability was not observed.
- `PROCESSING`: the destination reports asynchronous processing.
- `OBSERVED_PUBLISHED`: an independent destination observation with a fingerprint exists.
- `FAILED`: the request failed or reconciliation proved the resource absent.
- `UNKNOWN`: the send may have taken effect but the reply was lost or inconclusive.

Individual channel participants are not atomic. One may be SENT while another is UNKNOWN. Launchwright does not roll one back to make the table look consistent.

## Custody before side effect

An external adapter must call `channel.claim` with its bounded, secret-free prepared request **before** its one network send. The request is persisted in the existing pending-request table and bound by SHA-256. `channel.claim` returns `send_once=true`.

After the send:

- exact response: `channel.complete`
- lost or ambiguous response: `channel.mark_unknown`
- destination inspection: `channel.reconcile`

No operation automatically resends. A transport acceptance alone can become at most SENT/PROCESSING. “Published” requires a separate observation source, timestamp, and fingerprint.

## Retry

A retry is intentionally awkward. The prior attempt must first be reconciled as `NOT_FOUND`, its pinned profile must permit reconciliation/native idempotency, and the operator must create a new `channel.prepare` with `retry_of` pointing to the latest attempt. The logical key is reused and the attempt number increases.

This prevents “timeout → send again” from silently creating duplicate posts, releases, uploads, or emails.

## Withdrawal

`channel.withdraw_plan` is a planning record, not an external delete. It records scope, reason, optional replacement candidate, and the pinned profile's withdrawal capability. Every current Withdrawal has:

- `state=PLAN_ONLY`
- `external_action_performed=false`
- `all_copies_removed=false`
- `universe_complete=false`

A future channel adapter may perform a supported withdrawal and attach destination evidence, but Launchwright will not claim that downstream caches, recipients, mirrors, or screenshots disappeared unless the evidence actually covers that universe.

## Cost boundary

ChannelAttempt records do not introduce a Launchwright cost ledger. `platform_cost_ledger=external` is an explicit boundary: worker usage, reservations, quotas, and billing remain Platform responsibilities.
