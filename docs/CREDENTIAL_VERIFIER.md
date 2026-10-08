# Credential-pattern verification — R30

Launchwright adds a candidate-wide credential-exposure check using the pinned Semwright Driver SDK.
It is NOT a general privacy certificate, arbitrary binary secret scanner, or authorization to publish.

## Host authority
Command: `driver.launchwright-verifier.credential-exposure` (read only).
The format verifier retains its independent descriptor. Frozen candidate, artifact IDs,
SHA-256 digests, sizes and MIME are bound to the report. The Broker authorizes execution,
Driver Host isolates it, and only the dedicated Native SDK verifier profile has the
separate read-only grant to consume SHA-pinned Host receipts. The browser cannot self-certify.

## Scope
Supported: UTF-8 plain text, Markdown, HTML, VTT and JSON (including decoded
Unicode-escaped keys and values, depth <=32). Fixed patterns include PEM/OpenSSH/PGP
private key headers, GitHub and GitLab token prefixes, Stripe secret-key prefixes,
Slack xox tokens, AWS AKIA/ASIA key identifiers, and long Authorization: Bearer headers.
Detected markers are blockers. Unsupported MIME, invalid UTF-8/JSON, embedded NUL
or overly deep JSON fail closed. All findings are generic codes and messages;
no credential bytes, token fragments or line excerpts are emitted.

## Limitations
PASS means only that these fixed patterns were absent in the exact candidate
text bytes at this frozen revision. The scan may miss unknown providers, short
tokens, ordinary passwords, encoded/encrypted/compressed content, HTML entities,
or text embedded in images/video. It may flag harmless examples. Credential-exposure
remains distinct from privacy, rights, accessibility, semantic/editorial, Platform,
human approval and publication gates. Opaque PNG/MP4/GLB candidates do not obtain PASS.

## Operator flow
Render, freeze and require the independent dimensions
`["format", "credential-exposure"]`. Execute through Broker/Policy/
Driver Host, then record its pinned receipt using the isolated Native verifier.
Inspect verification.summary and candidate.inspect. On FAIL or stale revision,
fix the original, rerender, freeze a new candidate and repeat. Waivers do not
convert FAIL to PASS. A separate text-only candidate does not grant authority
to the full release candidate.

The exact-SHA R30 CI lane proved driver validate/conformance, clean PASS,
contaminated fixture FAIL with redacted finding, wrong dimension rejection,
policy denial, SHA and candidate/artifact binding and real Native admission.
