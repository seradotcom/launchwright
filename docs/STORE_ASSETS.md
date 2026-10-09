# R44 — Apple/Google store listing asset packs from source-bound candidate

R44 creates a **private, reproducible ZIP** of screenshots, graphics and operator-written listing text for a *bounded* subset of Apple App Store Connect and Google Play listing formats. This is an actual local package, not merely a generic "zip" channel profile. It is not a store upload, app binary, pricing/age/privacy disclosure certification or publication.

## Supported policy subsets (snapshot October 9, 2026)

| Profile key | Screenshot requirement admitted by R44 | Additional image files |
| --- | --- | --- |
| `apple-iphone-dynamic-island-medium` | 1–10 iPhone portrait screenshots; exactly **1179×2556** or **1206×2622** pixels, PNG 24-bit/no alpha after normalization | None; iPad, large iPhone, Mac and other Apple device profiles are separately unsupported |
| `google-play-phone-portrait` | 2–8 source screenshots at **1080×1920** pixels, normalized to PNG 24-bit/no alpha. This is a deliberately narrow technical subset of Play's wider allowable dimensions. | Operator-selected **512×512 RGBA 32-bit app icon with alpha**, max 1024 KiB, and **1024×500 RGB 24-bit feature graphic with no alpha** |

Metadata follows current documented listing limits: app name ≤30 Unicode characters on both stores; Apple's subtitle ≤30 and Google Play's short description ≤80; long description ≤4,000 characters. Apple keywords are required within 100 UTF-8 bytes in this subset. R44 requires HTTPS support/privacy URL strings but **does not fetch or verify** them.

Official reference pages, checked for the October 2026 snapshot:

- [Apple screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications)
- [Apple app information and name/subtitle limits](https://developer.apple.com/help/app-store-connect/reference/app-information/app-information)
- [Apple version description requirements](https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information)
- [Google Play store media, icons, graphics and screenshots](https://support.google.com/googleplay/android-developer/answer/9866151?hl=en-en)
- [Google Play metadata limits](https://support.google.com/googleplay/android-developer/answer/9859152?hl=en-en)

Google's recommendation-placement guidance for apps calls for **four** screenshots at 1080px or higher. A 2-screenshot package may meet the generic listing minimum but is explicitly marked `NOT_ESTABLISHED` for that recommendation. Neither the 4-image count nor correct pixels prove promotion eligibility or Google policy acceptance.

Store rules change. These are **operator-reviewed technical profiles**, not an evergreen guarantee of admission in App Store Connect or Play Console.

## Sources and authorization

The exact Native SDK local release, target, human-approved frozen candidate and versioned `channel_profile` must all refer to the same release/product. The profile declares the corresponding destination class `external-draft`, exact supported device, PNG format and `recover-first` behavior.

Each screenshot is selected explicitly from a private PNG file, with a SHA-256 and a Launchwright `evidence` ID for a scoped `SANITIZED_DERIVATIVE` capture. The source capture, approved source and release build must match; the candidate and channel revision are recorded. Changed source pixels, versions or evidence IDs invalidate the saved plan.

**Critical limitation:** current capture evidence records a provenance chain but does not cryptographically bind the screenshot's complete pixel buffer to an independently admitted device/Host capture receipt. Therefore R44 retains `source_pixel_authenticity: operator-declaration-only`. The operator separately declares rights and pixel sanitization; technical acceptance stays `UNKNOWN`. No human or automated privacy/trademark/content truth certification is inferred.

Input PNG pixel dimensions are verified by the IHDR and full PNG decode, and the original SHA must match. Input metadata chunks are discarded, fully opaque screenshots/feature images are losslessly normalized to truecolor PNG without alpha, and Google app icons preserve their required alpha channel. **No resizing, visual synthesis, text overlays, screenshot substitution or automatic localization** occurs. Missing support for a source resolution fails the plan.

## Two-phase operator CLI

Create a private input selection JSON (mode 0600 on POSIX), structured like this example but using real already-approved local resource IDs and absolute private screenshot paths:

```json
{
  "platform": "apple-iphone-dynamic-island-medium",
  "release_id": "EXACT_RELEASE_ID",
  "target_id": "EXACT_TARGET_ID",
  "candidate_id": "EXACT_CANDIDATE_ID",
  "channel_profile_id": "EXACT_APPLE_CHANNEL_PROFILE_ID",
  "locale": "en-US",
  "metadata": {
    "name": "Your existing app",
    "summary": "Operator reviewed subtitle",
    "description": "Operator supplied product description.",
    "keywords": "reviewed,app",
    "support_url": "https://example.com/support",
    "privacy_policy_url": "https://example.com/privacy"
  },
  "source_rights": "owned",
  "screenshots": [
    {
      "source_evidence_id": "EXACT_SANITIZED_EVIDENCE_ID",
      "png": {
        "path": "/private/owned/iphone-screenshot.png",
        "sha256": "FULL_SOURCE_PNG_SHA256"
      },
      "alt": "Accessibility description written by a reviewer"
    }
  ],
  "graphics": {"icon": null, "feature": null},
  "acknowledge_private_only": true,
  "acknowledge_source_rights": true,
  "acknowledge_pixel_privacy": true
}
```

For Google, use `google-play-phone-portrait`, leave keywords empty, provide at least two phone screenshots and populate both `graphics.icon` and `graphics.feature` using the same `{path,sha256}` shape. Those graphics are operator-owned, not claimed as captured UI.

Plan without any Native resource or external publication mutation:

```sh
node scripts/store-package.mjs plan \
  --state /private/launchwright-workspace \
  --input /private/store-source-selection.json \
  --out /private/store-package-plan.json
```

Review and explicitly confirm both exact hashes before writing anything:

```sh
node scripts/store-package.mjs export \
  --state /private/launchwright-workspace \
  --input /private/store-source-selection.json \
  --plan /private/store-package-plan.json \
  --out-dir /private/store-package-output \
  --confirm-plan FULL_PLAN_SHA256 \
  --confirm-candidate FULL_CANDIDATE_SHA256 \
  --acknowledge-private-export
```

The output directory must be an existing private 0700 directory on POSIX. The plan is created exclusively, never overwritten. The private directory receives a real ZIP plus a SHA-bound receipt. ZIP content contains `listing.json`, `manifest.json`, PNGs, `preview.html` and a safety README.

`preview.html` is a static script-free offline review page. It embeds PNG pixels directly (data URIs), uses a restrictive CSP, has no network calls or JavaScript, and preserves the exact user-entered listing strings. Do not publish this preview without independent pixel/privacy/content review.

An interrupted export reuses already-matching files from the **same** plan. Modified existing outputs, untrusted symlink output directories or an unknown concurrent operator lock fail closed. No account tokens, remote API requests, app binary, billing, submission approval or Platform job is involved.

## Acceptance and remaining original master obligations

R44 tests use real disposable Git-independent Launchwright Native SDK/SQLite workspace entities, frozen/editorial-reviewed candidate, source-approved synthetic capture/derivative evidence, PNG decode/normalization, store-profile sizing, private ZIP and exact replay. The manual GitHub Actions Store assets lane runs an independent real Chromium review at widths **320, 390, 768 and 1440** and retains owned fixture previews, PNGs, ZIPs and SHA reports. This tests local *technical packaging*, not actual device-origin pixels or remote accounts.

The original master `STORE_PACKAGE` remains **PARTIAL** until all required device families/localizations, icon/feature visual and rights review, preview video rules, accessibility, live customer content, full App Store/Play policy revisions, and actual store-account draft upload/rejection feedback are accepted. Separate APPLE_UPLOAD and PLAY_UPLOAD profiles remain MISSING; Semwright Platform Publish is still blocked upstream.
