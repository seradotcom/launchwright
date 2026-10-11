# R71 — Bounded multi-document editorial carry-forward

R71 extends [R70's source-bound single-document review drafts](CARRY_FORWARD.md).
Instead of manually repeating the complete two-stage workflow for every
Markdown file, an owner can explicitly select **2–8 independent historical
Markdown artifacts from one editorial-approved frozen Candidate** and map
them to matching Targets and individual new draft titles in another Release
of the *same* Product. The whole selection is covered by a single saved
SHA-256 plan and reviewed together before any write.

This is an application-local authoring convenience. It does not imply
that the previous release was technically accurate or that new-release
features, availability, licensing, claims, pixel privacy, capture, metadata,
human approval or accessibility are valid.

## Workflow from the existing Launchwright web workspace

1. Select the **new draft Release** in Launchwright.
2. Open **Carry-forward drafts**. The original single-document R70 tool
   remains available; below it, find **Batch editorial carry-forward**.
3. Select one previously frozen Candidate of the same Product. Candidates
   must have at least two Markdown artifacts. Choose only artifacts you
   are authorized to reuse; claim-linked or CopyBlock-managed source
   documents cannot be copied.
4. For each selected artifact, confirm a new-release Target whose name,
   locale, audience, plan, region and feature flags match the historical
   Target. Set an independently reviewable name for every draft.
5. Independently acknowledge historical source rights and the need for
   fresh human review. **Prepare exact batch plan** is read-only; it
   verifies every selected R70 source/destination pairing and returns
   one ordered plan of their original R70 hashes plus a batch SHA-256.
   The plan includes no private Markdown body, filesystems or tokens.
6. Review each source artifact SHA-256 and new document name, download
   the private JSON plan, and then independently retype the **entire**
   batch SHA-256, **entire** Candidate SHA-256 and destination build.
   Check explicit authorization before **Create / reconcile selected
   review drafts**.
7. Each source becomes one **new** Markdown Deliverable with R70's
   compulsory visible re-verification warning. A separate existing Native
   `relation.record` stores `editorial_carry_forward` provenance with
   `completeness=unknown`. No preexisting source, evidence, claim,
   artifact, verifier, approval or deployment is edited or inherited.

## Durability, concurrency, and recovery

- The batch **shares the same workspace-scoped exclusive writer lock**
  as individual R70 operations. Concurrent single-item/batch writers are
  rejected, never interleaved.
- The service **preflights every source, immutable approval, target,
  rights declaration, exact plan and already-created draft** under that
  lock before the first mutation. Changed historical source or manually
  edited destination draft fails closed *without writing other items*.
- The operation is **not one atomic database transaction**: each item
  uses R70's existing Native SDK `entity.create` and
  `relation.record` transactions. A crash may leave some documents
  completed and one document without its relation.
- **Inspect existing batch** is read-only. States are `NOT_APPLIED`,
  `PARTIAL_NEEDS_RECONCILIATION`, and `BATCH_READY`, with per-item
  Native IDs and statuses. Never claim batch success after a partial
  crash or lost HTTP response.
- Re-applying the **same original saved plan** requires a fresh operator
  confirmation and can only create missing canonical document/relation
  records. The operation cannot overwrite human edits, create duplicate
  documents, or silently regenerate source bytes. If any item is
  inconsistent, the entire reapplication fails closed for manual review.
- Saved plans are kept in browser-tab memory until an explicit private
  download. They never enter `localStorage`, external APIs or Platform
  jobs. Full browser reload requires restore of the original JSON.

## Validation and limitations

R71's application unit tests exercise deterministic order, per-source
deduplication, target/title collision, 2–8 bound, immutable Native records,
owner-only routes, cross-origin denial, exact consent, no inherited
verification, source drift, tampered plans, existing human edits,
durability across processes, concurrent R70/R71 locking, source-specific
partial failures and lost HTTP ACK recovery.

Its Node 24 CI runs on Linux/macOS/Windows through the existing
application workflow. A distinct owned Chromium workflow drives a real
two-release Semwright Native SDK/SQLite fixture at 1440, 768, 390 and
320 px, saves the original R71 JSON plan, confirms all SHA identities,
creates two independent document/relation pairs, reloads and recovers.
Only the repository-owned synthetic fixture is covered: customer source
admission, Semwright Driver Host/capture, full semantic and rights review,
actual publication, external cross-tenant identity and canonical Semwright
Platform Publish remain unaccepted.

Whole-master status stays **BLOCKED**. A batch convenience feature cannot
promote any of the original 196 requirements or 36 E2E scenarios to PASS
without exact independent evidence.
