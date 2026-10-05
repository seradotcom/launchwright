# DeltaDesk owned browser laboratory

DeltaDesk is the Launchwright-owned web product used to exercise release behavior without customer data, productive authentication, payments, or third-party application rights. It is deliberately small but behaviorally meaningful: two immutable build identities expose the same product surfaces while changing release-relevant semantics.

## Build contract

| Build | Identity | Checkout CTA | Checkout plan selector | Basic operator advanced export | Pro operator advanced export |
| --- | --- | --- | --- | --- | --- |
| A | `deltadesk-a-2026.10.02.1` | `Start Pro trial` | before CTA | available | available |
| B | `deltadesk-b-2026.10.05.1` | `Continue with Pro` | after CTA | unavailable | available |

The fixture supports `en-US` and `es-MX`, `operator` and `viewer` roles, and `basic` and `pro` plans. It includes demo login, request list, request detail and a non-transactional checkout surface. `POST /lab/reset` resets only fixture-owned synthetic state. No real account, payment, email, production credential or external customer record exists.

The canonical source description is `lab/deltadesk/manifest.json`. Unit tests assert the A/B oracle directly so a later UI rewrite cannot silently remove the intended release changes.

## Browser runtime contract

Launchwright does not implement another browser automation kernel. The browser profile pins the reviewed Semwright source commit:

`4d291de26724810017ce7b6d185326514cb79fa6`

and provider ID:

`chromium`

`profile.preflight` fails closed until the runtime owner declares all of:

1. an approved `web` Source whose build matches the selected Release;
2. an `http:` or `https:` source locator without URL credentials;
3. explicit browser execution authority;
4. the exact reviewed Semwright SHA and provider ID; and
5. a concrete 64-hex SHA-256 for the disposable Chromium executable.

The executable path itself is not stored in Launchwright domain state. It remains runtime-owned.

Source-profile operations live in the dedicated `sources` Native SDK bridge profile. This keeps the canonical 48 KiB NodeBridge limit unchanged while leaving material growth headroom in the main `core` profile.

## Real Semwright CI acceptance

The manual `deltadesk` lane in `.github/workflows/heavy.yml` is the cross-system browser acceptance path. On a disposable GitHub runner it:

1. checks out this exact Launchwright SHA;
2. checks out exact reviewed Semwright `4d291de26724810017ce7b6d185326514cb79fa6`;
3. installs a disposable Chromium binary and records its SHA-256;
4. starts the owned DeltaDesk A/B server on loopback and performs an explicit reset;
5. copies `acceptance/chromium_deltadesk.rs` into that disposable Semwright checkout as an acceptance test only;
6. executes the real Semwright `Chromium` semantic adapter against DeltaDesk;
7. uses semantic queries/actions for login, role/plan selection, navigation and release assertions;
8. asks Semwright for real browser screenshot artifacts, copies the exact PNG bytes into CI evidence, and verifies Semwright removes its own temporary screenshot artifact on browser shutdown;
9. verifies the A/B behavior oracle and exact screenshot hashes; and
10. binds the observed runtime back to Launchwright `profile.preflight`.

Playwright is used only to install a disposable Chromium build. It is not the capture authority and does not drive the acceptance interaction.

The retained browser receipt explicitly records `agent_javascript: false`, `raw_cdp_exposed: false` and `platform_job_receipt: false`.

## Authority boundary

A successful `deltadesk` lane establishes real execution of the reviewed Semwright Chromium adapter against the owned DeltaDesk fixture and validates Launchwright's browser compatibility contract for that exact SHA/runtime.

It does **not** establish any of the following:

- a canonical Semwright Platform job receipt;
- admission through Launchwright `capture.ingest`;
- canonical Project Graph/effects coverage;
- Driver Host isolation acceptance for Launchwright;
- real customer-product capture;
- Android/iOS acceptance;
- Composition rendering;
- external publication or production deployment.

Those states remain false/UNKNOWN until their own authorities produce exact evidence. The browser acceptance lane intentionally refuses to manufacture those receipts.
