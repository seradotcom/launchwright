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

`d2da9a495a53fe279a1ca4de61f0e24646350f22` (current reviewed post-v1.0.0 source; base release `v1.0.0` is `8fa191250ae68274182570c65f067f7a60f85625`)

and executes Semwright's reviewed `chromium` backend through the real `Broker` + `Policy` path against the owned DeltaDesk fixture. The R23 acceptance code lives in `acceptance/chromium_deltadesk_broker.rs` and is copied only into the disposable CI checkout as a `semwright-daemon` integration test; it does not patch or vendor the backend, Broker or Policy into Launchwright. The older direct-backend harness remains isolated to the separate Composition evidence lane and does not substitute for R23 Broker evidence.

The R23 lane uses semantic query/action operations for demo identity selection, navigation and assertions, asks Semwright for real browser screenshot artifacts, copies those exact PNG bytes into retained evidence, and verifies that Semwright cleans up its temporary artifact paths on shutdown. A bounded CI-only fixture approver accepts only `browser.launch` and `browser.screenshot` for the selected `chromium` backend. Separate negative controls prove that `browser.launch` is denied without `browser.modify` and that an origin outside the owner allowlist is denied.

## Launchwright ingestion boundary

The R23 Broker-routed lane is real browser execution through Semwright Policy, but its sensitive-action approval is a bounded CI fixture rather than a human/operator approval. It is not a Semwright Platform job and it is not canonical Driver Host acceptance. Therefore `scripts/verify-deltadesk-browser.mjs` does **not** manufacture a `platform_job_id`, human approval, native Host receipt, verifier PASS or observed-product admission.

Instead, the exact Broker-routed receipt and screenshot hashes are recorded through the existing `launchwright-capture/2` contract as:

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
5. installs the same `libpipewire-0.3-dev` Linux build prerequisite used by the pinned Semwright CI;
6. compiles and runs the Launchwright-owned integration test against the pinned `semwright-daemon`, preserving its exact `Cargo.lock`, so execution traverses the real Broker + Policy + Chromium backend;
7. requires both fail-closed controls (missing `browser.modify` and forbidden origin), the semantic A/B oracles, screenshot bytes and Semwright-owned artifact cleanup;
8. ingests those receipts into a temporary Launchwright workspace as `IMPORTED_UNVERIFIED` capture records; and
9. uploads the complete `evidence/deltadesk/` directory.

The retained receipt explicitly records that agent JavaScript and raw CDP were not exposed and that no Platform job receipt was claimed.

## What a PASS means

A passing `deltadesk` lane establishes real execution of the exact pinned Semwright Broker + Policy + Chromium path against the owned DeltaDesk A/B fixture and proves that Launchwright can preserve that evidence without overstating authority. R23 source SHA `ce92ffbd3402b8a374fa664f3da65b63c1d69193` passed run `37569447808`, job `112624530363`; artifact `11459528622` contains the Broker receipt, two PNG captures and the Launchwright ingestion report. Application checks run `37569449701` passed on Linux, Windows and macOS for the same source SHA.

It does **not** establish:

- canonical Platform job execution;
- human/operator approval of sensitive browser actions;
- canonical Driver Host isolation/admission;
- observed-product capture admission;
- real customer-product capture;
- canonical Project Graph/effects coverage;
- Composition rendering;
- Android/iOS/Godot acceptance;
- external publication; or
- commercial production deployment.

Those states remain separate and UNKNOWN until their own authorities produce exact evidence.
