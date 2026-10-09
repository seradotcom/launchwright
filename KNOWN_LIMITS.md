# Known limitations and unresolved original master requirements

**Overall master acceptance is BLOCKED**. The capability matrix is the
machine-checked inventory of 18 profiles from the original private SRS.
A green local browser/MCP test is not proof of real customer acceptance.

## Missing or incomplete CORE paths

- DOCS_GIT: no independently accepted owner Git docs PR/writeback adapter yet; R32 Git read-only metadata and R33 editorial drafts are not PRs.
- DECK_PDF: no delivered editable deck + real PDF export and visual QA for a complete owned release.
- INTERACTIVE_DEMO: the Launchwright admin interface is real, but not a sanitized navigable *captured product* demo.
- STORE_PACKAGE: generic channel ZIPs require store-specific sizes/assets/schema/policy and acceptance.
- VIDEO: the owned R24 canonical MP4 fixture exists; two-format/captions/quality/user-content acceptance remains partial.
- PUBLISH_PRIVATE: canonical Semwright Platform Publish API, deployment, cross-tenant identity, job/metering/output ACLs are not in the reviewed SDK source. Local product-version rehearsal cannot substitute.
- WEB/CLI/DOCS_STATIC: technical owned-fixture paths exist; customer capture, complete second-release selective/full rebuild, output integrity, rights and review gates remain incomplete.

## External acceptance with implementation debt

Real Android/iOS capture and App Store/Play upload adapters are not accepted.
A local MCP client is not host acceptance in ChatGPT Plugin or equivalent
remote accounts. Third-party CMS destination remains a bounded descriptor
rather than a generally accepted runnable CMS integration.

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
