# R70 — Explicit editorial carry-forward across two releases

R70 turns Launchwright's version-aware historical records into a **new,
review-required Markdown draft** in a different build of the *same* Product.
It complements R54/R67's read-only continuity comparison and R68/R69's
operator-controlled Git documentation delivery. It is **not automatic
artifact caching, approval inheritance, product execution or publication**.

## Why this exists

Historical editorial material often contains wording worth revisiting in a
new release. A byte-identical or title-identical prior page, however, does
not prove current feature availability, rights, pricing, screenshots,
semantics, translations, security or correct behavior. R70 makes a bounded
human-assisted *handoff*, not a reuse verdict.

## Operator workflow

1. In the prior release, render a Markdown Deliverable, freeze an exact
   Candidate, and record a human **APPROVED_EDITORIAL** decision for that
   candidate. The source Candidate and Artifact must still be fresh.
2. Create a **different draft release** of the same Product, with a
   distinct build identity and a new Target whose name, locale, role, plan,
   region and feature flags match the historical Target. Viewport may differ;
   layout does **not** inherit acceptance.
3. Open **Carry-forward drafts**, select the historical Candidate and exact
   frozen Markdown Artifact, destination Target and new draft title. Declare
   that you have rights to use the historical copy and understand that fresh
   editorial review is necessary.
4. Select **Prepare source-bound plan**. The owner-only POST
   `/api/v1/release-carry-forward/plan` returns a SHA-256-bound plan
   identifying source Candidate/review, exact source Artifact bytes, old
   Deliverable version, new Release/Target revision, new build and
   deterministic destination draft hash. No source body or source paths are
   included in the plan; no workspace write or external call occurs.
5. Save the original plan JSON privately. **Re-enter** the complete plan
   SHA-256, historical Candidate SHA-256 and destination build, plus explicit
   consent. Only then use **Create or reconcile private draft**.
6. The Native SDK dispatcher creates a **new editable Markdown Deliverable**
   for the destination release with a conspicuous review-required warning
   and historical source candidate/artifact hash. The new Deliverable has
   **no claims, CopyBlocks, source references, evidence, verifier records,
   media artifacts or old approvals**. A separate Native `relation.record`
   tracks `editorial_carry_forward` between old and new Deliverables with
   `provenance=declared`, `completeness=unknown` and no Graph admission.
7. After any lost reply, use **Read back draft status** or restore the same
   saved plan JSON. `NOT_APPLIED`, `PARTIAL_NEEDS_RECONCILIATION` and
   `DRAFT_READY` distinguish incomplete work. Only deliberate re-apply of
   the original plan can create a missing relation; there are no automatic
   retries or duplicate Deliverables.

## Fail-closed constraints

- Only an owner-authenticated local session can plan, inspect or apply;
  generic consumer bearers and cross-origin requests are rejected.
- Historical Candidate must remain fresh, human editorial-approved, have
  exact frozen Markdown bytes, and contain a **claim-free, unmanaged**
  Deliverable. Claim-linked and CopyBlock-managed documents are excluded
  until authored and verified anew for the destination build.
- Different Products, same build, target mismatch, changed approvals,
  source revision drift, retired/non-draft destinations, incorrect hashes,
  conflicting deterministic names and nonmatching old/new Target context
  fail without creating a new document.
- Repeated exact requests reconcile the same two Native resources.
  Edited human drafts are never overwritten, nor are unrelated documents
  with the same human title.
- A workspace-scoped exclusive writer lock prevents concurrent partial
  applications. Stale locks require manual review, not auto-stealing.
- Original release/candidate/artifacts/aliases are not edited. A new
  output must be *rendered and frozen separately* after fresh review; the
  historical candidate's approval never applies to the new Draft.

## Acceptance and scope

Node 24 CI requires the three-OS main application suite. The separate
R70 owned-browser workflow exercises disposable two-release real
Semwright Native SDK/SQLite resources, exact recovery, negative cases,
and Chromium at **320, 390, 768 and 1440 px**, retaining SHA-linked
screenshots. Node 22 workstation runs are supplemental only.

The original master remains **BLOCKED**. This workflow does **not**
establish real customer rights, source capture, semantic/technical proof,
accessibility, independent editorial approval for the new release,
automatic asset reuse, canonical Project Graph coverage, external channels,
Semwright Platform Publish, teams or hosted deployment.
