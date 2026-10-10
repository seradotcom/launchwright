# R48 — Emulator-only Android screenshot capture

R48 observes an installed app on a **local Android emulator only** and imports a matching screenshot into Launchwright through its existing Semwright Native SDK dispatcher. The resulting evidence is always `imported-declaration / technical UNKNOWN / host_acceptance NOT_ESTABLISHED`. It is **not a Semwright Android Driver Host**.

No personal phone, wireless/TCP device, arbitrary device shell command, installer, activity launch, account login, project script or external publication is invoked by the R48 adapter.

## Prerequisites and authority

Start with an approved Launchwright Source (`type: mobile-import`, `locator: android-emulator:YOUR.PACKAGE`, `approval: approved` and a written purpose), a draft Release and a Target with the same emulator screen dimensions. The Source and Release must carry the same **operator-declared build label**.

The operator explicitly declares `owned` or `licensed` screenshot rights. R48 checks the chosen package is installed using `adb shell pm path`, **not its APK contents, signature, version code, copyright or provenance**. Real device build verification and privacy admission are NOT established.

Only `emulator-PORT` transports with `ro.kernel.qemu=1` are accepted. Physical device serials, wireless endpoints and unsupported device sizes/API levels are denied before screenshot capture. Independently open and foreground the exact intended app. The R48 adapter never installs or starts it.

## Phase 1: private plan, no screen effects

```sh
node scripts/android-emulator-capture.mjs plan \
  --state /private/launchwright-state \
  --release RELEASE_ID --target TARGET_ID --source SOURCE_ID \
  --serial emulator-5554 \
  --package com.example.ownedapp --rights owned \
  --out /private/android-plan.json \
  --emulator-only --imported-unknown
```

The exclusive private plan (0600 on POSIX) binds original Native Source/Release/Target revisions, SDK level, emulator fingerprint digest, installed package-path digest and target display size, with an exact plan SHA. No screenshots, source code or login data are imported during planning.

## Phase 2: explicitly authorized screenshot

Create a private output directory (0700 on POSIX). Independently confirm the plan SHA, package name and original **declared** build label:

```sh
node scripts/android-emulator-capture.mjs capture \
  --state /private/launchwright-state \
  --plan /private/android-plan.json \
  --out-dir /private/android-results \
  --confirm-plan FULL_PLAN_SHA256 \
  --confirm-package com.example.ownedapp \
  --confirm-build OPERATOR_DECLARED_BUILD_LABEL \
  --approve-screen --acknowledge-pixel-privacy
```

R48 checks the focused/resumed package before and after the real `adb exec-out screencap -p`, rejects context drift, validates PNG pixels/CRC/dimensions and re-encodes the image to remove PNG metadata. It writes a private PNG and private SHA-linked receipt, then records one Native SDK `evidence.import` resource scoped to the exact Release/Source/Target, classification `imported` and technical `UNKNOWN`.

The pixel-privacy flag is an **acknowledgement that independent privacy review has NOT occurred**, not a claim of PII removal. The output is never automatically public. A workspace-level exclusive lock prevents concurrent captures.

An interrupted Native import can be reconciled using the **same** saved screenshot and receipt, without another screencap. Changed PNG bytes/receipt, unsafe directories, stale device identity and orphan PNG files lacking a receipt all fail closed; manual operator inspection is required instead of an unsafe rescan.

## Real owned synthetic Android acceptance

The selective `.github/workflows/android-emulator.yml` job boots Android 34 on a disposable Google APIs x86_64 emulator. It builds an **owned minimal synthetic Java APK** from checked-in source, with no network/contacts/storage permissions or user data. A separate CI-only build script installs and foregrounds that app, then R48 captures its pixels and saves one actual Android PNG plus receipts. The CI verifies the PNG SHA/dimensions, Native imported-UNKNOWN evidence and recovery without recapture, and retains the owned screenshot for review.

The regular supported Node24 Windows/macOS/Linux tests exercise strict ADB command budgets and failure paths through an injected test runner with a real Native SDK/SQLite workspace.

**Limits:** This does not establish a Semwright Android Driver Host, Platform job, real mobile phone, customer APK binary attestation, actual customer app acceptance, pixel PII/rights certification or iOS support. The original Android profile is PARTIAL after successful emulator acceptance, not COMPLETE.

Supply-chain controls: `pngjs@7.0.0` is MIT; ReactiveCircus Android Emulator Runner is pinned to full commit `a421e43855164a8197daf9d8d40fe71c6996bb0d` (Apache-2.0). Android build tools and AVD images are installed only on disposable CI runners. The app observer uses fixed `adb` argv with `shell:false`, no client-supplied executable or arbitrary commands.
