# Operator runbooks

This is a navigation point, not another automation service.
Read docs/RUNBOOK.md for the detailed existing operator and incident workflow.

## Recover a lost mutation acknowledgement

Inspect the durable prepared request key and exact SHA. Use Launchwright's
read-only recover endpoint or the optional MCP launchwright_recover with the
**same original** key. Never generate a new submit or recreate a remote
object to guess whether an old command succeeded. A remote GitHub release
draft must be re-read and downloaded to compare exact bytes; only DRAFT,
not published, is in scope.

## Prepare a changed release

Pin the product build, source, target, claims and any available external
receipts. Use Impact Inbox to see registered dependencies and unknown
coverage. Propose new content against an exact base revision; never
overwrite human-owned copy or historical LTS material silently.
Re-render changed deliverables, review immutable candidate bytes and
record technical verifiers independently from human editorial approval.

## Diagnose missing capacity

Run node src/main.mjs doctor --state <DIR>. It reports temporary and
workspace volumes independently; an UNKNOWN capacity state is never
assumed healthy. If temporary space is exhausted, choose a private
temporary directory on a properly sized filesystem. Never delete
unrelated projects, user caches, credentials, worktrees or archived
acceptance artifacts as a side effect of testing.

## Prepare an external publication

The application currently supports strict local channel packages and
owner-controlled GitHub Release DRAFT custody, **not** universal or
canonical Semwright Platform publication. External GitHub deployment,
ChatGPT Plugin host acceptance, app-store accounts and customer
sources require explicit authorization and independent receipts.
Do not mark a stage LIVE based on a local manifest.
