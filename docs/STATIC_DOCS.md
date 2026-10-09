# R45 — Version-bound offline static documentation

R45 generates a complete **script-free, offline HTML documentation microsite** from two to twelve exact, human-approved Markdown artifacts frozen into the **same** Launchwright Candidate, Release and editorial Target. It is not a remote website deployment. It does not execute code examples, fetch remote assets, infer product behavior, change Platform state or turn UNKNOWN into PASS.

## Product flow

1. Author and review your Markdown deliverables inside the normal Release workspace. Each page has a short `# Title` and optionally additional `##`/`###` headings, ordered/bulleted lists, paragraphs, safe internal links and fenced code examples using three tildes (for example `~~~bash`). Launchwright's normal Markdown exporter contributes the exact Release/build/locale source disclaimer.
2. Render each deliverable with the existing Native SDK dispatcher and freeze every resulting Markdown Artifact in one Candidate.
3. Obtain editorial approval for the exact Candidate SHA. An imported/UNKNOWN technical outcome needs a separate explicit unverified-evidence acknowledgement.
4. Prepare the no-effects static documentation plan, selecting all page artifact IDs, exact versioned slugs and a private output plan file.
5. Review the resulting plan SHA, Candidate SHA, source-page hashes and expected offline ZIP digest. Explicitly export to a private existing directory (0700 on POSIX).
6. Unzip the resulting archive for private review. Open `index.html` and navigate its source-bound documentation links. No browser scripts or network access are needed. No public deployment is performed.

## Input format and link safety

Use a private file `docs-pages.json` containing the exact frozen artifact IDs, for example:

```json
[
  {"slug":"getting-started","artifact_id":"artifact_EXACT_RETURNED_ID"},
  {"slug":"api","artifact_id":"artifact_ANOTHER_RETURNED_ID"}
]
```

Markdown pages may link only to other declared pages: `[API guide](./api.html)`. Such links are checked before the site can be exported; external links, traversal paths, remote resources, raw HTML, images, custom scripts, broken references, unclosed examples, tables and unsupported Markdown fail closed rather than silently becoming unsafe or incomplete.

At least one explicit internal documentation link and one code example are required to demonstrate the site's actual documentation features. Fenced languages are a bounded allowlist (text, bash, sh, json, js, ts, python, rust, yaml, toml, html, css and sql). **Code is escaped and rendered as inert text**, not interpreted or run. The site builds an accessible sidebar, skip link, focus styles and responsive layouts. Complex Markdown and customer asset rights remain future work.

## Two-phase local CLI

```sh
node scripts/static-docs.mjs plan \
  --state /private/launchwright-state \
  --candidate CANDIDATE_ID \
  --pages-file /private/docs-pages.json \
  --out /private/static-docs-plan.json \
  --acknowledge-draft \
  --acknowledge-source-rights \
  --acknowledge-unknown
```

This command validates the complete exact source link graph and builds the expected archive in memory without creating application resources or writing output to a website. The **only saved file** is the private SHA-bound plan (created with exclusive permissions 0600 on POSIX). Existing plans cannot be overwritten.

```sh
node scripts/static-docs.mjs export \
  --state /private/launchwright-state \
  --plan-file /private/static-docs-plan.json \
  --out-dir /private/docs-output \
  --confirm-plan FULL_64_CHARACTER_PLAN_SHA256 \
  --confirm-candidate FULL_64_CHARACTER_CANDIDATE_SHA256 \
  --acknowledge-private-export
```

R45 creates a deterministic ZIP and SHA-256 source receipt. ZIP metadata and CSS are stable, so repeat exports from the same immutable Candidate reproduce the exact same archive bytes. The output is restricted to the operator's chosen private directory and never overwritten if it has changed. Partial output from a killed process may be completed by rerunning the **same exact plan**. An exclusive workspace lock prevents concurrent writers and requires deliberate manual review of any stale lock.

## Continuity between releases

Every HTML page includes the approved Release identity/build and frozen Candidate digest. The manifest records the page slug, source Artifact IDs, exact Markdown digests, code-sample counts, checked links and receipt boundaries. Different releases are different plans and ZIPs; generating the new version never edits the older release's ZIP or takes ownership of its paths. A changed source deliverable or candidate invalidates a previously saved plan.

## Security and acceptance

The offline HTML has a strict Content Security Policy (default/script/connect/font/image/frame/object sources set to none, with only a pinned inline CSS hash). It contains no JavaScript, forms, external images, credential links or active code examples. Untrusted Markdown text is escaped; only same-site `./slug.html` links are rendered. The visitor's browser needs no server.

The [selective CI workflow](../.github/workflows/static-docs.yml) validates the source with the canonical Semwright Native SDK v1, performs structural/negative and **two-release continuity** tests, generates an actual owned synthetic source ZIP and opens the extracted HTML in **real Chromium** to check links, keyboard focus, code display, responsive viewports and zero external requests. Screenshots and ZIP receipts are retained for the exact source SHA.

This is source-linked **owned synthetic acceptance** only, not general customer documentation approval, independent WCAG certification, external hosting, actual SDK code-example execution, customer-specific content rights or canonical Semwright Platform Publish. Rich layouts, image evidence and real cross-release customer acceptance remain outside R45.
