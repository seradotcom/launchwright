# R37 — Local web onboarding for existing Git projects

R37 brings the bounded R32 → R35 onboarding workflow into Launchwright's **local owner-authenticated UI**. It does not add a Git runner to the web server or bypass the canonical Semwright Native SDK.

## Supported operator journey

1. **Observe an owned Git project.** Run the documented [R32 observer](GIT_CHANGE_SOURCE.md) on the same machine, choosing exact base and head commit identities. R32 creates a private JSON snapshot of committed filename/status metadata. The browser and R37 HTTP routes do not accept arbitrary source repository paths.
2. **Open Launchwright and select Import Git project.** Unlock with the local owner session. Choose the R32 JSON using the browser file picker (240 KiB maximum). The list of changed filenames is never displayed in the UI. Source metadata stays in memory, not cookies or localStorage.
3. **Prepare a plan.** Enter a product/release/source name, approved purpose, editorial target and rights declaration. The server validates the R32 observation, then R35 creates a deterministic private plan. Planning performs zero workspace mutations. Download the plan JSON for later use or reload a previously saved plan and verify it against the selected original observation.
4. **Explicitly apply.** Re-enter the full 64-character plan SHA-256 and exact 40-character head commit, and affirm four independent approvals: source purpose, declared rights, imported UNKNOWN evidence and human editorial review. Only the local owner can invoke this operation; consumer bearers are denied.
5. **Review the output.** R35 uses the Native SDK dispatcher to create/reconcile Product, draft Release, approved CLI Source, Target, imported Evidence and Markdown Deliverable. Then open the new release from the UI. Evidence remains technical UNKNOWN, and notes remain editorial drafts.

## Loopback owner-only endpoints

- `POST /api/v1/local-git-bootstrap/plan` accepts exactly R32 observation and operator config. It returns a private plan and proves the workspace was not mutated. It cannot accept a local Git directory path, executable command, URL, arbitrary file handle or credentials.
- `POST /api/v1/local-git-bootstrap/apply` accepts the original observation, exact private plan and independent confirmations. It returns the six resource identities and explicit non-authority states. The existing Native SDK dispatcher performs all resource mutations.

Both endpoints reuse Host/Origin/fetch-site and authenticated owner session protections, the 256 KiB HTTP body limit and local loopback binding. Consumer bearer accounts cannot access either endpoint. Browser owner authentication is not a remote tenant identity.

CLI and HTTP share one exclusive local bootstrap lock, so they cannot create resources concurrently. Interrupted requests must be reconciled with the same exact saved plan; no automatic retry or substitute plan is issued. A stale lock requires human verification before manual removal.

No external GitHub release, Semwright Platform Publish deployment, Git fetch/pull or customer source script is run by this feature.

## Data minimization and recovery

The R32 observation JSON may contain sensitive changed filenames. They are not shown in the web view, but the operator-selected observation is sent to the loopback service for exact validation. Persisted imported Evidence contains source/commit digests and counts, not Git patch text.

Neither the selected observation nor the R35 plan is persisted to browser localStorage. When the page is refreshed, select the original observation again and reload the private saved plan; the server revalidates it without mutation. Selecting an invalid replacement source file clears the previous in-memory plan rather than accidentally applying stale settings.

## Acceptance and limits

The Node tests cover owner-vs-consumer authentication, cross-Origin rejection, size/schema controls, SHA and acknowledgement binding, CLI/server lock exclusion, partial Native transaction failure and idempotent reconciliation, saved-plan recovery and no source filename disclosure.

The real Chromium Browser CI lane exercises the full operator workflow on a disposable owned Git fixture: login, select private R32 file, prepare digest-bound plan, type confirmations, reconcile six Native resources, verify imported UNKNOWN evidence and open the editorial release. Retained screenshots are test evidence for this owned local UI scenario only.

This does not establish customer-project acceptance, Semwright Driver Host isolation, Platform execution, external publication or automatic proof of feature and rights claims. See [R35 local Git bootstrap](GIT_PROJECT_BOOTSTRAP.md).
