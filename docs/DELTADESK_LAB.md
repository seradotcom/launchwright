# DeltaDesk owned browser laboratory

DeltaDesk is a Launchwright-owned synthetic web product used to exercise release-sensitive browser behavior without customer data, productive authentication, payments, external accounts or third-party application rights. Two immutable build identities expose the same product while intentionally changing a small set of observable release semantics.

## Build contract

| Build | Identity | Checkout CTA | Checkout plan selector | Basic operator advanced export | Pro operator advanced export |
| --- | --- | --- | --- | --- | --- |
| A | `deltadesk-a-2026.10.02.1` | `Start Pro trial` | before CTA | available | available |
| B | `deltadesk-b-2026.10.05.1` | `Continue with Pro` | after CTA | unavailable | available |

The fixture supports `en-US` and `es-MX`, `operator` and `viewer` roles, and `basic` and `pro` plans. It includes demo login, request list, request detail and a non-transactional checkout surface. `POST /lab/reset` resets only fixture-owned synthetic state.

The canonical source description is `lab/deltadesk/manifest.json`. Unit tests assert the A/B oracle directly so a later UI rewrite cannot silently erase the intended changes.

## Exact Semwright runtime

Launchwright does not implement a second browser automation kernel. The cross-system acceptance lane checks out the same Semwright commit pinned by `SOURCE_LOCK.json`:

`4d291de26724810017ce7b6d185326514cb79fa6`

and executes Semwright's reviewed `chromium` semantic adapter against the owned DeltaDesk fixture. The acceptance code lives in `acceptance/chromium_deltadesk.rs` and is copied only into the disposable CI checkout of Semwright; it does not patch or vendor the adapter into Launchwright.

The lane uses semantic query/action operations for demo identity selection, navigation and assertions, asks Semwright for real browser screenshot artifacts, copies those exact PNG bytes into retained evidence, and verifies that Semwright cleans up its temporary artifact paths on shutdown.

## Launchwright ingestion boundary

The direct adapter lane is real browser execution, but it is not a Semwright Platform job and it is not canonical Driver Host acceptance. Therefore `scripts/verify-deltadesk-browser.mjs` does **not** manufacture a `platform_job_id`, native Host receipt, verifier PASS or observed-product admission.

Instead, the exact adapter receipt and screenshot hashes are recorded through the existing `launchwright-capture/2` contract as:

- `classification: imported`;
- `provenance.capture_class: IMPORTED_UNVERIFIED`;
- `receipt.authority: imported`;
- `technical: UNKNOWN`;
- `host_acceptance: NOT_ESTABLISHED`;
- `observed_state_eligible: false`.

This preserves the real cross-system evidence inside the Launchwright domain while keeping the authority boundary fail-closed. A future Platform/Driver Host integration can produce a separate observed capture with the required canonical receipts; this imported record remains historical evidence rather than being promoted in place.

## Heavy acceptance

The manual `deltadesk` lane in `.github/workflows/heavy.yml` runs on a disposable GitHub Ubuntu runner and:

1. checks out the exact Launchwright SHA;
2. checks out exact pinned Semwright source;
3. binds the runner Chromium executable and records its SHA-256;
4. starts and resets the owned DeltaDesk A/B fixture on loopback;
5. compiles and runs the Launchwright-owned acceptance test inside the pinned Semwright adapter crate;
6. validates semantic A/B oracles and screenshot bytes;
7. ingests those receipts into a temporary Launchwright workspace as `IMPORTED_UNVERIFIED` capture records; and
8. uploads the complete `evidence/deltadesk/` directory.

The retained receipt explicitly records that agent JavaScript and raw CDP were not exposed and that no Platform job receipt was claimed.

## What a PASS means

A passing `deltadesk` lane establishes real execution of the exact pinned Semwright Chromium semantic adapter against the owned DeltaDesk A/B fixture and proves that Launchwright can preserve that evidence without overstating authority.

It does **not** establish:

- canonical Platform job execution;
- canonical Driver Host isolation/admission;
- observed-product capture admission;
- real customer-product capture;
- canonical Project Graph/effects coverage;
- Composition rendering;
- Android/iOS/Godot acceptance;
- external publication; or
- commercial production deployment.

Those states remain separate and UNKNOWN until their own authorities produce exact evidence.
