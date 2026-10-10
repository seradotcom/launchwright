# R47 — Operator-approved WordPress CMS DRAFT integration

R47 implements one concrete CMS channel against the **WordPress Posts REST API**. It uses Launchwright's existing Native SDK-backed Product, Release, Candidate, frozen Markdown Artifact, Channel Profile, Channel Package and Channel Outcome journal. It does **not** create a second backend, grant Semwright Platform Publish authority, or publish a website.

The selected operation is only creating a **WordPress post with status DRAFT**. It does not activate posts, edit an existing post, upload arbitrary media, alter users, create accounts, merge changes, update plugins, or send third-party tracking requests.

## Existing approved Native resources

Before preparing a CMS intent, create or identify a reviewed local Release and frozen Markdown Artifact, then create a **channel_profile** with these required values:

```json
{
  "name": "Approved WordPress editor",
  "channel": "wordpress-post-draft",
  "profile_version": "wp/v2/r47",
  "destination_class": "external-draft",
  "requirements": {"format": "markdown"},
  "source": "wordpress-draft:https://cms.example.org",
  "effective_at": "2026-10-09T00:00:00.000Z",
  "idempotency": "recover-first"
}
```

The profile also needs its real `product_id`. Pin that **exact profile revision** in the immutable Candidate when freezing it, obtain an independent `APPROVED_EDITORIAL` review, and create a `PACKAGE_READY` Channel Package with the profile. The package must be unsent and unmodified, and the artifact must be frozen in the same Candidate. Use the normal Launchwright UI Delivery Board or authenticated Client SDK / Native dispatcher for these preconditions; do not manually fabricate resource IDs or Native receipts.

The destination site is a single explicit WordPress **HTTPS origin**. A local `http://127.0.0.1:PORT` is allowed solely to support owner-controlled disposable testing. Arbitrary HTTP, URL paths, query strings, URL credentials, redirected requests and hidden credential-bearing URLs are rejected. R47 supports the root `/wp-json/wp/v2/posts` endpoint, not an arbitrary CMS URL or multisite subdirectory. A real remote site must be independently authorized by its owner.

## Private credentials

Generate a dedicated, least-privilege WordPress *Application Password* for a human-authorized content editor in the site's WordPress account settings. Save it in an existing **0600 private JSON file** on the operator's computer; never pass its contents as CLI arguments, store them in Launchwright, paste them in ChatGPT, or commit them to the repository.

```json
{
  "username": "operator",
  "application_password": "APPLICATION_PASSWORD_FROM_WORDPRESS_ACCOUNT"
}
```

WordPress supports Application Passwords for REST API authentication. The provider uses HTTP Basic authentication **only over explicitly configured HTTPS**, except loopback synthetic fixtures. Redirects are disabled to prevent transferring authorization headers to a different origin. Responses must be bounded JSON; a malformed, oversized, redirected or unauthorized response fails closed.

## Step 1 — Prepare the immutable private intent (zero network)

```sh
node scripts/wordpress-draft.mjs plan \
  --state /absolute/private/launchwright-state \
  --delivery CHANNEL_DELIVERY_ID \
  --origin https://cms.example.org \
  --title "Release notes for editorial review" \
  --notes-artifact MARKDOWN_ARTIFACT_ID \
  --out /absolute/private/wordpress-draft-plan.json \
  --acknowledge-draft \
  --acknowledge-site-control \
  --acknowledge-source-rights \
  --acknowledge-unverified
```

The saved file is created exclusively with POSIX 0600. It binds the exact candidate revision/hash, source Markdown bytes, Channel Profile, Channel Package SHA, title and destination site. The deterministic WordPress draft slug is derived from the intent SHA-256. **No WordPress account is contacted, and no Launchwright resource is mutated by this planning step.**

An operator must independently acknowledge technical UNKNOWN if the frozen candidate lacks authoritative verification. This does not upgrade technical proof or source permissions.

## Step 2 — Explicitly send a DRAFT

Read the plan's original intent SHA and candidate SHA. Confirm both and the exact site origin separately:

```sh
node scripts/wordpress-draft.mjs send \
  --state /absolute/private/launchwright-state \
  --intent /absolute/private/wordpress-draft-plan.json \
  --credentials /absolute/private/wordpress-app-password.json \
  --confirm-origin https://cms.example.org \
  --confirm-candidate FULL_CANDIDATE_SHA256 \
  --confirm-intent FULL_INTENT_SHA256 \
  --acknowledge-send \
  --out /absolute/private/wordpress-draft-receipt.json
```

The operator CLI uses an exclusive local lock, checks for a prior matching WordPress post by deterministic slug with `context=edit` and `status=any`, and creates a post **only if no prior post is found**. The outgoing JSON is limited to `status: draft`, the slug, approved title and escaped Markdown represented as inert HTML, plus closed comments/pings.

The remote post is then independently read back from both the slug lookup and `/wp/v2/posts/{id}?context=edit`. Its **raw title and complete raw content must match byte-for-byte**, with the exact slug, post type, draft status, closed comments/pings and stable post ID. A server-side normalization, injected HTML, published status or human edit is a **Conflict**, never overwritten. Only then does the canonical Launchwright `channel.record_outcome` record the exact `DRAFT_CREATED` receipt.

There is no `publish`, `update`, `DELETE`, or generic arbitrary JSON endpoint exposed.

## Lost reply / recovery

If a request times out or the POST result becomes uncertain, **do not resend**. Use the original saved plan and call:

```sh
node scripts/wordpress-draft.mjs recover \
  --state /absolute/private/launchwright-state \
  --intent /absolute/private/wordpress-draft-plan.json \
  --credentials /absolute/private/wordpress-app-password.json \
  --confirm-origin https://cms.example.org \
  --confirm-candidate FULL_CANDIDATE_SHA256 \
  --confirm-intent FULL_INTENT_SHA256
```

Recovery only issues read-only WordPress REST queries and reconciles a matching native outcome receipt; it does **not** create a new remote draft. An absent, externally edited, deleted, published, closed or duplicate resource requires manual operator review. A stale local lock after abnormal termination is cleared **only** by a human after verifying there is no active sender. Identical local retries reuse the existing Native outcome, not duplicate receipt rows.

The saved plan has no credential value. It may still disclose origin/source IDs and must remain private.

## Owned acceptance and limitations

The R47 ordinary Node tests use a real loopback HTTP server implementing the documented WordPress posts API, including Application Password Basic authentication and real POST/GET state. They simulate timeout after remote commit, edited raw bytes, changed publication status, redirects, stale source, altered hashes, wrong origin, missing consent and unsafe credential permissions.

A **separate selective GitHub Actions lane** starts a disposable genuine WordPress + MySQL site, initializes a synthetic operator and temporary Application Password, and performs the real REST read/create/read/recover protocol. Neither a third-party account nor a real customer site is used. The local test credentials and ephemeral database are destroyed after the run; only non-secret evidence is retained.

This proves a bounded WordPress **Draft** adapter against owned fixtures. It does **not** independently establish customer consent, live WordPress account privileges, real deployment or webhook behavior, other CMS platforms, general content sanitization, accessibility, privacy or rights certification, public activation, Semwright Platform Publish, or the complete original master.

See WordPress's official [Posts REST API](https://developer.wordpress.org/rest-api/reference/posts/) and [Application Passwords](https://developer.wordpress.org/rest-api/using-the-rest-api/authentication/).
