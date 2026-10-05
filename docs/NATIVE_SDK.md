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

The Rust adapter uses the actual NativeDriver/NodeBridge path and binds the generated Launchwright bundle hash at build time. Because the canonical NodeBridge limits a pinned bundle file to 48 KiB, the build retains the minified uncompressed payload as CI evidence and materializes a deterministic Brotli wrapper. The wrapper is itself SHA-256 pinned by Rust and verifies the uncompressed payload SHA-256 before executing it; no runtime caller can replace either digest or inject source.

`dist/native-bundle.json` records wrapper bytes/hash, uncompressed payload bytes/hash, packaging method and remaining canonical stdin-frame budget. The raw `dist/launchwright.payload.cjs` is uploaded with the wrapper so the executed payload remains auditable instead of being hidden by compression.

## What this does not prove

Source equality and local bridge tests do not prove that a production Broker/Driver Host accepted Launchwright. Native/Host acceptance evidence must identify the exact Launchwright commit, native bundle digest, compiler and workflow/run that produced it.
