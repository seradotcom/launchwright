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
| ANDROID_CAPTURE | EXTERNAL_ACCEPTANCE | MISSING | not tested | Bounded Android runner/adapter implementation and authorized emulator/device acceptance |
| IOS_CAPTURE | EXTERNAL_ACCEPTANCE | MISSING | not tested | Bounded iOS runner/adapter implementation and authorized macOS/simulator acceptance |
| DOCS_STATIC | CORE | PARTIAL | local application ci | Version-bound complete static site, links, code samples, accessibility and cross-release regression acceptance |
| DOCS_GIT | CORE | PARTIAL | Exact source b69d17aafbb4; CI run 37874876016 | Live operator GitHub DRAFT PR creation and readback, remote reviewers/merge, docs website deployment, customer ownership and exact published-version acceptance remain external; R41 tests use injected GitHub provider. |
| VIDEO | CORE | PARTIAL | Exact source 635bf1c4d02b; CI run 37582490691 | Two output formats, independently inspected editorial quality, caption/voice variants and real customer/source acceptance |
| DECK_PDF | CORE | PARTIAL | Exact source 9f9bdfbdd6bb; CI run 37906146250 | R42 reviewed text-only PPTX and real PDF passed separate Poppler and LibreOffice owned synthetic runs. Rich media, multilingual embedded fonts, customer branding/permissions, accessibility and independent editorial design acceptance remain missing. |
| INTERACTIVE_DEMO | CORE | PARTIAL | Exact source 7c6097605584; CI run 37978319215 | R43 real Chromium offline radio/keyboard/CSP/viewport navigation passed on owned synthetic PNGs only. Running customer-product interactions, independent pixel privacy/source rights verification, multi-browser accessibility and Platform/Host acceptance remain missing. |
| STORE_PACKAGE | CORE | PARTIAL | local application ci | R44 adds a candidate local Apple iPhone Dynamic Island medium and Google Play phone pixel/metadata listing ZIP, pending exact Node24 and Chromium CI. Independent device pixel source, rights/privacy/content, other device/locale policies, app binary and live store account uploads remain unaccepted. |
| APPLE_UPLOAD | EXTERNAL_ACCEPTANCE | MISSING | not tested | Bounded App Store Connect draft upload adapter; external account/permission acceptance separately required |
| PLAY_UPLOAD | EXTERNAL_ACCEPTANCE | MISSING | not tested | Bounded Google Play draft asset adapter; external account/permission acceptance separately required |
| PLUGIN_HOST | EXTERNAL_ACCEPTANCE | PARTIAL | Exact source 751f586d9c2f; CI run 37870767220 | Installed and authorized ChatGPT Plugin host, same-job Studio deep link and actual host interaction acceptance |
| PUBLISH_PRIVATE | CORE | BLOCKED_UPSTREAM | local consumer rehearsal | Canonical Semwright Platform Publish API, ProductVersion deployment, authenticated tenant isolation, metered job and output ACL; current pinned SDK lacks that API |
| CUSTOM_CMS | PROFILE | PARTIAL | extension contract only | Versioned runnable CMS destination adapter against operator-owned test endpoint and readback |
| PUBLIC_SOCIAL_POST | FUTURE_OPTION | OUT_OF_SCOPE | not required | Direct social auto-publication was explicitly not a core requirement |

PARTIAL is not COMPLETE. An OWNED_FIXTURE CI acceptance is not a real
customer or ChatGPT host test. A generic ZIP/channel contract is not an
App Store/Play Store upload, and a Git metadata import is not a docs PR.

See SDK_GAPS.md, ACCEPTANCE.md, SOURCE_LOCK.json and the exact evidence/rNN
records. No external Publish, tenant authority, subscription, billing or
live customer acceptance is inferred.
