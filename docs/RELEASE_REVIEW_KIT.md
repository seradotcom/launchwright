# R64 — Release review kit across independent outputs

R64 assembles real existing Launchwright outputs for **one exact Native SDK-backed release and one frozen, editorial-approved candidate** into a private navigable release-review ZIP. It does not create a new rendering engine, approve product claims or publish externally.

The minimum kit contains a script-free R45 documentation site (multiple HTML pages with verified internal links) and an R42 editable PPTX plus real PDF. A source-bound R61 masked, CSS-only offline interactive demo is optional. Those outputs must already exist and retain their original exact private plans and receipts.

## Safety and provenance

- Documentation, PowerPoint and PDF must originate from the **same candidate SHA**, current release ID, build and technical UNKNOWN state. Cross-candidate or cross-release mixing fails.
- Docs are checked against the R45 plan, source ZIP checksum, private receipt and no-script HTML/manifest.
- PPTX/PDF are checked against the R42 plan/receipt and **independently re-rendered from frozen Native Markdown bytes**. A modified presentation cannot be smuggled by forging a new receipt SHA.
- Optional R61 demo requires a current imported Native Media revision and exact R59 masked screenshot lineage. This is NOT proof of PII absence outside masks or original application behavior.
- Outer ZIP contains an offline index, file-by-file SHA-256 manifest, docs HTML, editable PPTX, PDF and optionally masked demo HTML. No active scripts, external links or network resources are introduced.
- Source and output folders must be private existing absolute directories (0700 POSIX); source files are 0600 regular files. Symlinks, unexpected executable archive paths, oversized content, stale source identities and edited preexisting files are rejected.

Technical truth remains UNKNOWN. General rights, WCAG, customer product capture, Semwright Platform Publish and external channel review remain separate.

## Operator workflow

First export R45 docs and R42 PPTX/PDF, optionally R61 masked demo, using their original documented CLIs and **the same candidate**.

Prepare a private 0600 operator JSON with the shape:

```json
{
  "docs": {"plan": {"...": "exact R45 plan"}, "directory": "/private/docs"},
  "deck": {"plan": {"...": "exact R42 plan"}, "directory": "/private/deck"},
  "acknowledge_rights": true,
  "acknowledge_private_only": true
}
```

This is a shape illustration, not an executable replacement for a real plan. To include demo, add a demo property with its exact R61 plan and export directory.

Plan, without workspace mutation:

```sh
node scripts/release-review-kit.mjs plan --state /private/state \
  --input /private/kit-input.json --out /private/kit-plan.json
```

Then deliberately confirm both full SHA-256 hashes and export:

```sh
node scripts/release-review-kit.mjs export --state /private/state \
  --input /private/kit-input.json --plan /private/kit-plan.json \
  --out-dir /private/kit-output \
  --confirm-plan FULL_PLAN_SHA256 --confirm-candidate FULL_CANDIDATE_SHA256 \
  --acknowledge-private-export
```

Extract the resulting private ZIP and open its index.html. All links navigate locally to real outputs, not to a running customer product.

## Recovery and acceptance

On an interrupted file write, replay the **same** private plan. Existing files must match every byte of the regenerated kit before missing parts are created. A private lock prevents simultaneous kit writers. There is no automatic GitHub, app-store, cloud or remote Platform call.

The Node24 three-OS application matrix tests the contract. The manual owned-kit workflow creates a genuine ZIP from a **synthetic Native candidate**, independently checks file digests and uses real Chromium at 320, 390, 768 and 1440px with offline documentation navigation, retaining screenshots. Synthetic output validation does not prove actual customer acceptance or editorial design quality.

See docs/STATIC_DOCS.md, docs/DECK_PDF.md, docs/OFFLINE_HOTSPOTS.md and CAPABILITY_MATRIX.md.
