# Canonical Semwright Native SDK integration

Launchwright requires the Semwright Native SDK and does not substitute a hand-written compatibility layer.

## Reviewed source pin

- Semwright repository: `https://github.com/seradotcom/semwright`
- Commit: `4d291de26724810017ce7b6d185326514cb79fa6`
- Native SDK version: `0.9.0-dev.1`
- Required Node engine: `>=24.21.0 <25`

`SOURCE_LOCK.json` records SHA-256 values for every vendored public SDK source file. `node scripts/verify.mjs` verifies those bytes before acceptance.

The SDK package remains under its upstream MIT OR Apache-2.0 terms. New Launchwright code is AGPL-3.0-only.

## Used SDK behavior

Launchwright uses the canonical SDK for:

- `NativeApplication` dispatch semantics
- exact request digests
- opaque resource versions and `sameVersion`
- cancellation checks
- typed `NativeError` failures
- value/reply budget validation
- application context
- bridge entrypoint behavior

The Rust adapter uses the actual NativeDriver/NodeBridge path and binds the generated Launchwright bundle hash at build time.

## What this does not prove

Source equality and local bridge tests do not prove that a production Broker/Driver Host accepted Launchwright. Native/Host acceptance evidence must identify the exact Launchwright commit, native bundle digest, compiler and workflow/run that produced it.
