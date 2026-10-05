# Acceptance ledger

This file separates implemented behavior from execution evidence. It does not inherit passes from an upstream SHA or accept proposed schemas as real APIs.

## Current local checks

Initial isolated run: 58 tests passed on Node 22.16.0 in the build container, including SQLite persistence, stale revision CAS, exact idempotency, recovery, observation cursors, source bounds, immutable candidates, private alias CAS, imported evidence downgrade, safe text output, HTTP boundaries and the genuine canonical Node bridge in a separate process.

Node 22 is outside the upstream Native SDK's declared Node 24.21 engine. These are supplemental checks, not supported-engine acceptance. GitHub workflow execution is recorded separately with exact commit and run IDs after runs complete. The adapter simulations are explicitly synthetic, not live Platform acceptance.

## Not established by these tests

Canonical Driver Host isolation of Launchwright; production Platform connection; canonical Graph and effects admission; real web/mobile/Godot product captures; Composition/AV exports; public or cross-account publication; remote team authentication and approvals; ChatGPT Plugin host acceptance; commercial-production deployment.

Implementation of a source adapter or a passing contract test must never be represented as those end-to-end outcomes. Read `SOURCE_LOCK.json`, raw logs and the final evidence receipt together.
