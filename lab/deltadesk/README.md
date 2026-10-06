# DeltaDesk fixture

Owned synthetic product for Launchwright release acceptance.

Run locally:

```sh
PORT=4399 node lab/deltadesk/server.mjs 4399
```

Then inspect:

- `http://127.0.0.1:4399/build-a/login?locale=en-US`
- `http://127.0.0.1:4399/build-b/login?locale=en-US`
- `http://127.0.0.1:4399/health`

Reset fixture-owned state:

```sh
curl -X POST http://127.0.0.1:4399/lab/reset
```

The fixture has no productive authentication, payment flow, email delivery, third-party data, or customer secrets. Build identities and intended A/B changes are declared in `manifest.json`.

This server is a source product, not a screenshot generator. Real browser acceptance is performed in the heavy GitHub lane through Semwright's reviewed Chromium semantic adapter. See `docs/DELTADESK_LAB.md`.
