# Known limitations and unresolved original master requirements

**Overall master acceptance is BLOCKED**. The capability matrix is the
machine-checked inventory of 18 profiles from the original private SRS.
A green local browser/MCP test is not proof of real customer acceptance.

## Missing or incomplete CORE paths

- DOCS_GIT: R40 has a real owned local Git Markdown branch with exact source locks. R41 adds a bounded GH Draft PR plan/send/recover adapter tested with injected GitHub API responses. A real operator account GitHub PR, human review/merge and live documentation deployment remain unaccepted. R32 Git metadata and R33 outlines are not remote PRs.
- DECK_PDF: R42 provides source-linked text PPTX/PDF. R57 adds R55 masked Native image lineage to replaceable PPTX images and real PDF XObjects, pending Node24 document CI. Pixel privacy outside operator masks, complex content, rich image layouts, multilingual fonts, customer-brand/accessibility review and production customer acceptance remain unavailable.
- INTERACTIVE_DEMO: R43 adds source-pinned offline static navigation of explicitly selected Media-backed sanitized screenshot derivatives (owned synthetic Node24 Chromium Browser acceptance at source SHA 7c6097605584). It does NOT re-execute customer product behavior, independently verify pixel PII/rights, simulate forms/APIs or prove functional user journeys.
- PLAY_UPLOAD: R52 provides bounded R44-backed staging to an existing uncommitted Google Play Edit using official image GET/POST APIs, but not a real developer-account acceptance. The adapter never inserts or commits edits, deletes/replaces existing images, sets image order, submits an APK/AAB, or publishes. Manual Play Console review, authorized credentials, pixel PII/rights and Platform Publish remain separate.
- STORE_PACKAGE: R56 narrows Google Play local asset lineage to exact R55 manually masked PNG/Native derivative and R44 ZIP; icon/feature graphics and privacy outside masks are not independently verified. Other store profiles, complete real customer app/store policy, editor review and actual store acceptance remain unaccepted.
- VIDEO: existing owned canonical Composition MP4 fixture remains scoped. R46 introduces an aspect-only FFmpeg landscape/portrait MP4 + original AAC/approved frozen WebVTT package from operator-approved Native Media; generated portrait is imported UNKNOWN. Voice alternatives, captions burned in, human marketing quality, customer media, rights and external publication remain unaccepted.
- PUBLISH_PRIVATE: canonical Semwright Platform Publish API, deployment, cross-tenant identity, job/metering/output ACLs are not in the reviewed SDK source. Local product-version rehearsal cannot substitute.
- WEB/CLI: source-specific owned-fixture paths exist but customer execution/capture, selective full cross-release rebuild, rights and independent review remain incomplete. DOCS_STATIC: R45 accepted on Node24 and owned Chromium creates a real offline versioned Markdown HTML site with internal links, code examples and cross-release isolation in owned synthetic tests, but real customer content approvals, full media/multilingual styling, accessibility certification, code execution verification and external hosting remain open.

## External acceptance with implementation debt

Android/iOS customer capture and App Store/Play uploads are not accepted.
R48 provides an emulator-only source reader and owned synthetic Android
acceptance lane, but no physical phone, certified APK build proof or canonical
Android Driver Host/Platform job. R49 adds a bounded CoreSimulator
iPhone screenshot adapter and an owned synthetic Xcode/macOS runner pending
exact-SHA acceptance, but no real customer iOS execution, installed app
binary proof, independent pixel privacy or Driver Host/Platform authority.
A local MCP client is not host acceptance in ChatGPT Plugin or equivalent
remote accounts. R47 implements a concrete WordPress Posts REST DRAFT adapter with
synthetic HTTP integration and a separately gated genuine disposable
WordPress test. Other CMS platforms, customer website authorization,
public activation and Semwright Platform Publish remain unaccepted.

## Historical release-diff limitations (R54)

The new two-release HTML/JSON comparison can only enumerate artifacts
registered in the selected frozen local Native candidates. It identifies
byte-level artifact changes, editorial source copy equivalence, and the
registered-only claim/impact/channel frontier. It never automatically
reuses outputs across builds or validates whether product behavior,
screenshots, rights, semantics, accessibility or customer publish state
actually changed. Historical revision drift stops review rather than
reconstructing a fabricated prior state. The 21/36 public master
E2E references and Platform Publish missing authority remain unchanged.

## Safety and business

No general privacy/PII, rights, semantic truth, broad accessibility
certification, cross-tenant secure deployment or external payment
acceptance is implied. Login/sandbox/Host permissions are required for
actual tool execution. Public source backup ZIPs never include runtime
secrets or authorize Platform execution. Consumer usage and SaaS
billing are application-local rehearsal unless Platform is admitted.

No benchmark demonstrating commercial advantage against a competent
persistent Playwright/scripts/API baseline is accepted. No customer,
revenue, adoption or saved-time metric is invented.

See docs/SDK_GAPS.md, CAPABILITY_MATRIX.md and ACCEPTANCE_REPORT.json for
exact status. Progress on an individual release/wave cannot turn a
missing CORE profile into PASS.
