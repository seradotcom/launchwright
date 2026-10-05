# Mobile import contract

Launchwright supports a bounded **import** path for mobile screenshots and screen recordings. This is not a device driver and does not establish that Semwright, Launchwright, Android, iOS, Fastlane, a simulator or a physical device executed a capture.

## Trust boundary

The local CLI is the only component that receives a package directory. It validates filesystem containment and reads bounded bytes, then stages those bytes in the application content-addressed store. The canonical application mutation receives only a normalized manifest containing metadata, hashes and dimensions. Native NodeBridge calls never receive arbitrary filesystem paths or multi-megabyte asset bytes.

Every accepted bundle is recorded as imported / imported-unverified with technical state UNKNOWN, native capture false, Host acceptance NOT_ESTABLISHED and store review PENDING.

The imported files become immutable artifact resources that preserve the evidence/source/target/release pins needed by candidate and channel-package workflows. Packaging those bytes does not promote their technical state or claim an external upload.

## Package layout

A package is a real, non-symlink directory containing exactly the manifest name expected by the ingestor:

~~~text
mobile-export/
  launchwright-mobile-import.json
  overview.png
  walkthrough.mp4
~~~

Manifest asset paths use normalized relative POSIX syntax. Absolute paths, Windows drive paths, backslashes, traversal, symlink files and paths that resolve outside the package are rejected.

Example:

~~~json
{
  "schema_version": "launchwright-mobile-import/1",
  "release_id": "release_example",
  "target_id": "target_example",
  "source_id": "source_example",
  "name": "Owned mobile review bundle",
  "build": "build-A",
  "device": {
    "kind": "physical",
    "model": "Owned test phone"
  },
  "os": {
    "family": "android",
    "version": "16"
  },
  "locale": "en-US",
  "origin": {
    "kind": "external-device",
    "producer": "operator-export",
    "reference": "owned-review-session"
  },
  "captured_at": "2026-10-05T20:00:00.000Z",
  "assets": [
    {
      "path": "overview.png",
      "name": "overview.png",
      "kind": "screenshot",
      "mime": "image/png",
      "sha256": "<64 lowercase hex characters>",
      "width": 1080,
      "height": 2400,
      "rights": "owned"
    }
  ]
}
~~~

The manifest references an existing source whose type is mobile-import. The manifest build and the source build must match the target release build.

## Allowed assets and budgets

| Kind | MIME | Structural check |
| --- | --- | --- |
| screenshot | image/png | PNG signature, IHDR and declared dimensions |
| screenshot | image/jpeg | JPEG signature, bounded marker scan and SOF dimensions |
| screen-recording | video/mp4 | bounded ISO-BMFF box traversal, ftyp and non-zero visual-track dimensions |

Limits are deliberately small: at most 8 assets, at most 2 MiB per asset, at most 8 MiB for the package payload, and a 64 KiB JSON manifest. HTML, SVG, JavaScript and other active document formats are not accepted.

These checks establish structural consistency with the declared MIME and dimensions. They are not a full media decoder or a semantic visual verifier.

## Rights and review states

Each asset declares owned, licensed, unknown or restricted.

- all owned/licensed assets can reach READY_FOR_EDITORIAL_PACKAGE;
- any unknown rights produce PENDING_RIGHTS;
- any restricted asset produces BLOCKED_RIGHTS;
- stale source/target/build pins produce STALE;
- missing or changed bytes produce FAIL.

A ready editorial package can be frozen into a candidate and packaged for a pinned ChannelProfile while remaining an imported, technically unknown draft. Actual app-store submission, publication and store review are separate external actions.

## CLI

After creating the mobile-import source and the corresponding release/target resources:

~~~sh
node src/main.mjs mobile-import \
  --state .state \
  --package ./mobile-export \
  --request owned-mobile-import-001
~~~

The optional request key participates in Launchwright's normal exact-intent idempotency and recovery model. Reusing it for a different manifest conflicts.

## Public and Native API

The canonical operations are:

- mobile.import — mutation, scope capture; accepts only the normalized bounded manifest and requires all referenced hashes to already exist in the content-addressed store.
- mobile.inspect — read operation; rechecks stored bytes, dimensions, pins and rights state. It is exposed through the normal HTTP read surface and as LaunchwrightClient.mobileInspect(id).

Both operations are mapped to the canonical Semwright Native SDK integrations profile. This mapping proves application/bridge contract coverage only. Real Android/iOS execution and device isolation remain external acceptance gates.

## Security notes

Do not commit imported product captures or package directories. They may contain customer, account or unreleased-product information even when their manifest contains no credentials. The ingestor rejects credential-shaped manifest fields through the same bounded domain validation used elsewhere, but it cannot determine whether pixels or video frames contain sensitive information.
