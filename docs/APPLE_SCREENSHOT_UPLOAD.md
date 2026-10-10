# R51 — App Store Connect screenshot upload (operator-controlled)

R51 connects the exact R44 approved Apple iPhone private screenshot ZIP to an existing **App Store Connect Screenshot Set**. It can reserve screenshot assets, upload byte ranges, mark uploads complete, and read processing status. It does **not** submit the app for App Review, change binaries, activate storefronts, create app versions, or invoke Semwright Platform Publish.

Apple's documented four steps are: reserve appScreenshots, PUT its returned uploadOperations byte ranges, PATCH uploaded=true with the original MD5 sourceFileChecksum, and poll for asynchronous COMPLETE status.

Official technical references:

- https://developer.apple.com/documentation/appstoreconnectapi/uploading-assets-to-app-store-connect
- https://developer.apple.com/documentation/appstoreconnectapi/app-screenshots
- https://developer.apple.com/documentation/appstoreconnectapi/app-screenshot-sets
- https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/

## Prerequisites and authority

An authorized operator must already own the app, its existing App Store Version Localization ID and Screenshot Set ID, and an appropriate short-lived signed JWT generated from their Apple API credentials. The JWT is only read from a private 0600 regular file: R51 cannot create API keys, log the token or store signed upload URLs.

The source must be an exact R44 Apple iPhone Dynamic Island medium package, from a fresh, independently editorial-reviewed Launchwright Candidate. The operator-supplied JSON and original PNG files must still match all R44 Native SDK source/rights/evidence/pixel SHA bindings. R51 supports the R44 1179×2556 / 1206×2622 opaque portrait screenshot subset, with an existing Screenshot Set whose operator-verified display type is APP_IPHONE_61. That Apple type/resolution mapping must be checked in the actual account; additional device families are not automatically guessed.

The existing Apple Screenshot Set must be empty or contain an exact previously staged prefix of the approved screenshots. Foreign screenshots, duplicate filenames, wrong locale/device, unexpected processing states or human-edited content all fail closed.

## Prepare (zero external API requests)

```sh
node scripts/apple-screenshot-upload.mjs plan \
  --state /private/launchwright-workspace \
  --store-input /private/store-selection.json \
  --store-plan /private/store-package-plan.json \
  --store-zip /private/launchwright-store-EXACT.zip \
  --screenshot-set-id EXACT_SCREENSHOT_SET_ID \
  --localization-id EXACT_VERSION_LOCALIZATION_ID \
  --display-type APP_IPHONE_61 \
  --out /private/apple-asset-intent.json \
  --acknowledge-asset-only
```

The saved 0600 private intent binds the R44 plan, Candidate SHA, normalized screenshot PNG SHA-256 and MD5, sizes, complete exact ordered filenames, source Evidence IDs, selected Apple screenshot set and localization. It contains no JWT, signed URL, device code or private screenshot file path.

## Send only the screenshot assets

```sh
node scripts/apple-screenshot-upload.mjs send \
  --state /private/launchwright-workspace \
  --store-input /private/store-selection.json \
  --store-plan /private/store-package-plan.json \
  --store-zip /private/launchwright-store-EXACT.zip \
  --intent /private/apple-asset-intent.json \
  --token-file /private/operator-apple.jwt \
  --confirm-intent FULL_INTENT_SHA256 \
  --confirm-candidate FULL_CANDIDATE_SHA256 \
  --confirm-set EXACT_SCREENSHOT_SET_ID \
  --acknowledge-first-send \
  --out /private/apple-screenshot-receipt.json
```

Apple returns a structured `assetDeliveryState: {state, errors}` object rather than a string; R51 verifies that official shape and an empty errors array. The screenshot-set GET explicitly requests its localization relationship.

Before the first POST, R51 revalidates the entire R44 Native/ZIP source, independently confirms the operator's exact hashes and resource ID, then reads the remote screenshot set/localization and existing screenshots. Only after these checks does it create reservations, send all explicitly requested byte ranges to HTTPS Apple blobstore signed URLs (without JWT headers), and PATCH the exact MD5 for upload completion.

An UPLOAD_COMPLETE response means processing is still pending. Only COMPLETE indicates asset processing finished. Neither means the app was sent to review or published. R51 uses a private exclusive workspace lock and refuses to overwrite any operator receipt file.

## Recover a lost response without creating duplicates

```sh
node scripts/apple-screenshot-upload.mjs recover \
  --state /private/launchwright-workspace \
  --store-input /private/store-selection.json \
  --store-plan /private/store-package-plan.json \
  --store-zip /private/launchwright-store-EXACT.zip \
  --intent /private/apple-asset-intent.json \
  --token-file /private/operator-apple.jwt \
  --confirm-intent FULL_INTENT_SHA256 \
  --confirm-candidate FULL_CANDIDATE_SHA256 \
  --confirm-set EXACT_SCREENSHOT_SET_ID \
  --out /private/apple-recovery-receipt.json
```

Recover only uses GET requests. It distinguishes NOT_SENT_OR_PARTIAL, UNKNOWN_RESERVED_ASSET_REQUIRES_OPERATOR_REVIEW, PROCESSING_PENDING and SCREENSHOTS_PROCESSED. An AWAITING_UPLOAD reservation left by an ambiguous response must be manually reconciled in App Store Connect. No automatic duplicate reservation, signed-part resend, deletion, remote PR, app submission or publication is attempted. A stale lock needs human review before manual removal.

## Evidence and limitations

The synthetic tests validate real R44 Native/SQLite source bindings, genuine PNG ZIP bytes, a deterministic mocked Apple REST/blobstore protocol, MD5/SHA readback, all three lost-ack stages, unsafe-upload-URL/SSRF and header denials, incorrect set/locale/rights, exact consent and recovery without a duplicate write.

**No actual App Store Connect account was contacted in this test.** Real JWT/account authorization, independently reviewed pixel privacy and intellectual-property rights, Apple policy acceptance, async Apple processing feedback and any external reviewer approval remain unestablished. The APPLE_UPLOAD profile is still PARTIAL; it is not a final master acceptance.
