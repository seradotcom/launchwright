# R49 — Owned iPhone Simulator screenshot capture

R49 is a bounded, **read-only CoreSimulator observer** for a manually booted,
operator-approved iPhone Simulator with an already-installed app. It reuses
Launchwright's Native SDK release/source/target and evidence.import dispatcher.
It does not implement iOS Driver Host, real-device access, an Apple developer
account client, App Store upload or Semwright Platform Publish.

The selected device must be a unique Booted iPhone Simulator returned by
xcrun simctl; tvOS, iPad, physical devices, unavailable/shutdown simulators
and uninstalled app bundle IDs fail closed. The adapter invokes only fixed
simctl list, get_app_container and io screenshot operations, never boot,
install, launch, erase, shell or arbitrary customer scripts.

## Operator preparation

Manually install and foreground an authorized app in the simulator. An
existing Launchwright source must have mobile-import type, locator
ios-simulator:YOUR.BUNDLE.ID, approval approved, an explicit approved purpose
and the same release build label. The target belongs to that release and
declares the actual screenshot pixel width and height. This build label is
not evidence of executable binary attestation.

Save the source-bound plan with no capture or Native mutation:

```sh
node scripts/ios-simulator-capture.mjs plan \
  --state /private/workspace \
  --release RELEASE_ID --source SOURCE_ID --target TARGET_ID \
  --udid FULL_CORE_SIMULATOR_UUID --bundle com.example.ownerapp \
  --rights owned --out /private/ios-plan.json \
  --simulator-only --imported-unknown
```

The plan file is created privately and exclusively with 0600 POSIX mode.
Both app foreground and executable build identity remain independently
UNKNOWN: R49 does not infer them from an installed-app path.

## Explicit capture, import and recovery

Create an existing private output directory with 0700 POSIX mode. Confirm
the exact plan SHA, bundle, release build and screen, including uncertainty
about privacy and foreground state:

```sh
node scripts/ios-simulator-capture.mjs capture \
  --state /private/workspace --plan /private/ios-plan.json \
  --out-dir /private/ios-output \
  --confirm-plan FULL_PLAN_SHA256 \
  --confirm-bundle com.example.ownerapp \
  --confirm-build EXACT_RELEASE_BUILD_LABEL \
  --approve-current-screen \
  --acknowledge-foreground-unknown --acknowledge-pixel-privacy
```

The adapter captures the real CoreSimulator PNG, validates header, CRC,
dimensions and decoded pixel count, removes PNG metadata and preserves a
private SHA-bound screenshot/receipt. It then calls the canonical Native SDK
to import source/target/release-scoped evidence. Its class stays imported;
technical remains UNKNOWN, Host acceptance NOT_ESTABLISHED.

If a Native acknowledgement is lost after the files are written, rerun
exactly the same private plan. Both files are verified before any import;
the original screenshot is reused without another simctl screenshot.
An orphan PNG, edited receipt, colliding evidence, stale source identity,
unsafe directory or retained lock is a stop condition. Never delete user
files to force a retry.

## Selective real macOS CoreSimulator acceptance

The workflow .github/workflows/ios-simulator.yml compiles an owned synthetic
UIKit app from included source, boots an available disposable iPhone
Simulator, installs/launches that fixture separately from the adapter, then
checks real fixture pixels on the simulator. The tested adapter only reads
the screenshot and imports Native technical UNKNOWN evidence; it does not
build, boot, install or launch the application.

The Node 24 Linux, macOS and Windows matrix injects strict simctl fault
fixtures. The selective macOS workflow runs actual xcrun/CoreSimulator and
retains the exact PNG, plan, Native receipt and source/job metadata.

These checks do NOT certify customer iOS source, independent screenshot
privacy, actual installed binary hash, productive foreground isolation,
real physical hardware, Semwright Driver Host, Platform, Apple upload or
customer authorization. Those are distinct original-master acceptance gates.
