# R66 — Real GitHub Draft PR acceptance, synthetic owned fixture only

The operator used the actual R40 and R41 code, the canonical Semwright
Native SDK and an authenticated GitHub account to create
[Draft PR #90](https://github.com/seradotcom/launchwright/pull/90).
This was a reviewed synthetic Markdown file, NOT customer content.

Exact original source SHA: `de8695b8ccce4464c0e4104af69871e5ee61e5cc`.
Exact temporary head SHA: `50a995e2f81b507aee609b9aa93c07de320cd2a7`.
Changed path: `docs/OWNED_GH_DRAFT_E2E_R66.md`.
R40 plan: `ac24bf1d24fa511649f7c6ff943403783a11138d34d7f8fef6547df7e505356b`.
R41 intent: `a51981bdb8b98881e38b9d229427f6d3d622d048cab3ae0f8b3c2a069c374d35`.

The branch was created using local Git plumbing; the operator separately
pushed the exact commit to `seradotcom/launchwright`. R41 then
verified remote base/head SHAs, created the PR in DRAFT state, re-read
the exact title/body, owner, refs and GitHub URL, and performed a
**read-only recovery using the exact original intent**. Recovery
reported no second remote PR creation.

Following acceptance, PR #90 was **closed without merging** and the
temporary branch was **deleted from GitHub**. A fresh GitHub read
confirmed both cleanup states. This was not publication.

[Machine-readable receipt](../evidence/r66/live-github-draft.json)
contains source, GitHub URL, timestamps, SHA bindings, and explicit
authority boundaries. Private Native state, exact private intent files,
tokens and authenticated GitHub credentials remain outside this repo.

**Accepted:** live operator-owned Draft PR create/readback/recover and
closed-unmerged cleanup.

**Not accepted:** actual customer source, independent reviewer/merge,
hosted website deployment, independent rights/privacy verification,
tenant identity or Semwright Platform Publish. DOCS_GIT remains PARTIAL,
and the original master remains BLOCKED. The CI for this documentation
validates receipt consistency only, not a repeated GitHub mutation.
