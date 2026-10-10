# R52 — Stage Google Play images in an EXISTING, UNCOMMITTED Edit

R52 connects an exact operator-approved R44 Google Play PNG bundle with the official Android Publisher v3 Edit images API. **No new Edit is created, no previous screenshot is deleted and no Edit is committed or published.** The operator supplies an already-existing uncommitted Edit ID.

## Actual Google Play API semantics

Google's Edit is a temporary working copy; uploading an image into it does NOT publish that image. Only a separately authorized commit can apply those changes to the listing. Creating another Edit can invalidate work in progress, so R52 never invokes Edit creation either.

Official references:
- https://developers.google.com/android-publisher/api-ref/rest/v3/edits/get
- https://developers.google.com/android-publisher/api-ref/rest/v3/edits.images/list
- https://developers.google.com/android-publisher/api-ref/rest/v3/edits.images/upload
- https://developers.google.com/android-publisher/edits

Only the official AndroidPublisher HTTPS origin is permitted. The operator must provide a Play-authorized OAuth bearer file with the required androidpublisher scope, protected as private 0600 data on POSIX. The adapter does not acquire, refresh or expose tokens and does not follow redirects.

## Narrow R44 format support

R52 requires a complete, approved, SHA-bound R44 store ZIP with exact manifest, Candidate, channel, locale and provenance:

- 2–8 opaque 1080 × 1920 PNGs, Google imageType phoneScreenshots
- One 512 × 512 PNG icon, Google imageType icon
- One 1024 × 500 opaque feature PNG, Google imageType featureGraphic

The originally approved source PNGs, Candidate, channel policy, normalized bytes and user declarations are revalidated before any account contact. The Google image API does not promise list order: R52 checks SHA-256 uniqueness and membership without claiming that images are correctly ordered in a storefront. Visual ordering, pixels/PII, rights, locale and full Google Play policies require independent operator review.

The chosen Edit must have all three image slots **empty before the first send**. Existing published/listing assets copied into the Edit, earlier partial uploads or foreign images prevent first-send. R52 cannot delete or replace them. The Edit must have at least two minutes left before starting. Google Play may expire or invalidate an Edit without Launchwright's control.

## 1. Prepare an exact private plan without network effects

Create the R44 plan and ZIP using the documented R44 local package workflow, then independently acquire the existing Edit ID for the correct Play app:

```sh
node scripts/google-play-staging.mjs plan \
  --state /private/launchwright-workspace \
  --source-input /private/google-store-source.json \
  --store-plan /private/google-store-plan.json \
  --store-zip /private/launchwright-store-PLANPREFIX.zip \
  --package-name com.example.ownerapp \
  --edit-id EXISTING_PLAY_EDIT_ID \
  --out /private/google-play-intent.json \
  --acknowledge-uncommitted
```

The immutable plan includes source, Candidate, ZIP and image SHA-256, package/Edit and locale identities and explicit non-publication authority. It excludes local source paths and credentials. Its output file is exclusive and private.

## 2. Deliberate staging, never commit

Use a private token file; separately confirm the exact original intent, R44 source plan, app package and existing Edit. The application does no automatic remote retry:

```sh
node scripts/google-play-staging.mjs send \
  --state /private/launchwright-workspace \
  --source-input /private/google-store-source.json \
  --store-plan /private/google-store-plan.json \
  --store-zip /private/launchwright-store-PLANPREFIX.zip \
  --intent /private/google-play-intent.json \
  --token-file /private/play-oauth-access-token \
  --confirm-intent FULL_R52_INTENT_SHA256 \
  --confirm-store-plan FULL_R44_PLAN_SHA256 \
  --confirm-package com.example.ownerapp \
  --confirm-edit EXISTING_PLAY_EDIT_ID \
  --out /private/google-play-uncommitted-receipt.json \
  --acknowledge-first-upload
```

The transport performs GET of the existing Edit, GET of each supported image slot and POST of exact PNG bodies via uploadType=media, followed by independent GET/SHA readback. There is no edit creation, change of metadata text, APK/AAB, track, deletion or publication operation in this command. Success only means STAGED_IN_UNCOMMITTED_EDIT with technical UNKNOWN, published false and human review pending.

## 3. Recover an ambiguous POST without another write

If any upload response is lost, do not use send again. Recover only by reading the original exact intent and current remote Edit state:

```sh
node scripts/google-play-staging.mjs recover \
  --state /private/launchwright-workspace \
  --source-input /private/google-store-source.json \
  --store-plan /private/google-store-plan.json \
  --store-zip /private/launchwright-store-PLANPREFIX.zip \
  --intent /private/google-play-intent.json \
  --token-file /private/play-oauth-access-token \
  --confirm-intent FULL_R52_INTENT_SHA256 \
  --confirm-store-plan FULL_R44_PLAN_SHA256 \
  --confirm-package com.example.ownerapp \
  --confirm-edit EXISTING_PLAY_EDIT_ID \
  --out /private/google-play-recovery-receipt.json
```

Recovery returns NO_IMAGES_IN_EDIT, PARTIAL_UNCOMMITTED_EDIT or STAGED_IN_UNCOMMITTED_EDIT after read-only API calls. It never fills missing images, creates a new Edit, commits, uploads again or deletes existing work. A partial/expired Edit requires manual Play Console reconciliation and fresh operator review. A local exclusive lock prevents simultaneous writers from one Launchwright workspace; it does not prevent other users/computers changing the Play Edit.

## What the tests establish

The synthetic fixture uses a real R44 Native SDK/SQLite editorial Candidate, two 1080 × 1920 PNG screenshots, icon and feature image, plus a local HTTP server that checks the official Android Publisher v3 paths, authenticated bearer header and exact PNG bytes. Negative tests cover lost upload acknowledgment, tampered R44 source, foreign/duplicate images, expired Edits, missing confirmation, private-file permissions, read-only recovery and local exclusivity.

**No live Google Play developer account or productive Edit was contacted.** The tested subset does not certify device-origin authenticity, copyright or pixel PII, screenshot display order, actual Google account permissions, public listing submission, app store publication, customer rollout or Semwright Platform Publish. The original master PLAY_UPLOAD remains PARTIAL after local accepted tests.
