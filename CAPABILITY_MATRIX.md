# Master profile capability matrix — evidence, not marketing

Source: original Semwright Release Studio 0.1.0 profile IDs, reconciled
against the public Launchwright code/evidence. The private master ZIP is
not included or published. No profile is auto-promoted by a source file.

**Whole-master gate: BLOCKED.** Original 196 requirement IDs;
36 required E2E scenarios, only 21 referenced by the public ID-only requirements ledger.

| Profile | Scope | Implementation | Evidence level | Remaining obligation |
| --- | --- | --- | --- | --- |
| WEB | CORE | PARTIAL | Exact source ce92ffbd3402; CI run 37569447808 | Human-authorized real product capture admission and Host/Platform integration; owned fixture capture remains imported UNKNOWN |
| CLI | CORE | PARTIAL | Exact source 1a6b2313e3ab; CI run 37720793885 | Customer CLI run, provenance/capture acceptance and full output validation |
| GODOT | PROFILE | PARTIAL | Exact source 6c41a0b11870; CI run 37584900091 | Real customer Godot project, scene state isolation and effect/noninterference acceptance |
| MOBILE_IMPORT | PROFILE | PARTIAL | local contract ci | Device-origin proof and operator-licensed mobile bundles; no device execution asserted |
| ANDROID_CAPTURE | EXTERNAL_ACCEPTANCE | PARTIAL | local contract ci | R48 bounded Android emulator screenshot + exact Native imported UNKNOWN receipt; Node24 3OS fake ADB and owned real Android34 emulator CI pending. Customer APK provenance, physical device, independent pixel rights/PII, Native Driver Host and Platform admission remain absent. |
| IOS_CAPTURE | EXTERNAL_ACCEPTANCE | PARTIAL | local contract ci | R49 fixed CoreSimulator iPhone screenshot + exact imported UNKNOWN Native receipt, pending Node24 three-OS tests and real owned macOS UIKit fixture. Independent real customer app, source binary, pixel privacy/foreground, physical hardware, Driver Host and Platform remain external. |
| DOCS_STATIC | CORE | PARTIAL | Exact source 68c8baf1013c; CI run 38000643500 | R45 source-bound script-free multi-page site accepted on Node24 Linux/Windows/macOS and owned Chromium fixture. Complex images/docs/media, independent rights/PII/WCAG review, production sample execution, real customer version migrations and external hosting remain unaccepted. |
| DOCS_GIT | CORE | PARTIAL | Exact source b69d17aafbb4; CI run 37874876016 | Live operator GitHub DRAFT PR creation and readback, remote reviewers/merge, docs website deployment, customer ownership and exact published-version acceptance remain external; R41 tests use injected GitHub provider. |
| VIDEO | CORE | PARTIAL | Exact source 635bf1c4d02b; CI run 37582490691 | R46 source-bound landscape/portrait H264/AAC and frozen Native WebVTT, pending exact Node24/FFmpeg acceptance; alternate voice, burn-in captions, independent editorial video quality, customer footage/rights and Platform Publish remain unaccepted. |
| DECK_PDF | CORE | PARTIAL | Exact source 9f9bdfbdd6bb; CI run 37906146250 | R42 source-bound text PPTX/PDF and R57 exact R55 Native masked screenshot insertion into real editable PPTX/real PDF accepted on owned Node24 3-OS + Poppler/LibreOffice runs. Rich layout, broader fonts, accessibility, human visual/brand approval, privacy outside masks, real customer and Platform remain unaccepted. |
| INTERACTIVE_DEMO | CORE | PARTIAL | Exact source 7c6097605584; CI run 37978319215 | R43 real Chromium offline radio/keyboard/CSP/viewport navigation passed on owned synthetic PNGs only. Running customer-product interactions, independent pixel privacy/source rights verification, multi-browser accessibility and Platform/Host acceptance remain missing. |
| STORE_PACKAGE | CORE | PARTIAL | local application ci | R56 requires each Google Play phone screenshot to match exact R55 PNG mask/Native derivative and R44 ZIP, with owned local acceptance pending. Original device capture identity, privacy outside manual masks, graphics rights, Apple and additional store profiles, live account/policy/locale review remain unaccepted. |
| APPLE_UPLOAD | EXTERNAL_ACCEPTANCE | MISSING | not tested | Bounded App Store Connect draft upload adapter; external account/permission acceptance separately required |
| PLAY_UPLOAD | EXTERNAL_ACCEPTANCE | PARTIAL | local contract ci | R52 exact R44 approved PNG assets can be staged into an operator-existing uncommitted Google Play Edit using authenticated GET/image media POST. Owned HTTP/PNG protocol CI pending. Live developer account scope/credentials, screenshot order, existing-image replacement, independent pixel rights/PII, Edit commit, public listing, customer and canonical Platform Publish acceptance remain unavailable. |
| PLUGIN_HOST | EXTERNAL_ACCEPTANCE | PARTIAL | Exact source 751f586d9c2f; CI run 37870767220 | Installed and authorized ChatGPT Plugin host, same-job Studio deep link and actual host interaction acceptance |
| PUBLISH_PRIVATE | CORE | BLOCKED_UPSTREAM | local consumer rehearsal | Canonical Semwright Platform Publish API, ProductVersion deployment, authenticated tenant isolation, metered job and output ACL; current pinned SDK lacks that API |
| CUSTOM_CMS | PROFILE | PARTIAL | local contract ci | R47 WordPress DRAFT REST adapter pending accepted Node24 genuine disposable WordPress CI; other CMS providers, real customer accounts/consent, external review/publication and Semwright Platform Publish remain unaccepted. |
| PUBLIC_SOCIAL_POST | FUTURE_OPTION | OUT_OF_SCOPE | not required | Direct social auto-publication was explicitly not a core requirement |

PARTIAL is not COMPLETE. An OWNED_FIXTURE CI acceptance is not a real
customer or ChatGPT host test. A generic ZIP/channel contract is not an
App Store/Play Store upload, and a Git metadata import is not a docs PR.

See SDK_GAPS.md, ACCEPTANCE.md, SOURCE_LOCK.json and the exact evidence/rNN
records. No external Publish, tenant authority, subscription, billing or
live customer acceptance is inferred.
