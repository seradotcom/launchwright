# Canonical Effects readback custody

Launchwright uses the Effects surface from the exact pinned Semwright Native SDK at commit `4d291de26724810017ce7b6d185326514cb79fa6`. It does **not** implement another effects evaluator.

## Scope

The integrated upstream helper is `semwright-native-effects` / `effects_readback`, whose canonical scope is:

`immutable_native_sdk_artifact_properties_only`

It independently reads bounded JSON/CSV artifacts and evaluates the upstream Effect Contract for those immutable properties. The helper carries `execution_authority: false`.

That scope is intentionally narrower than proving native application mutation effects, noninterference, Host isolation, or the declared `scenario.effects` of a browser/Godot/product run. Launchwright therefore stores `scenario_effects_covered: false` even when a readback receipt is associated with a scenario.

## Application operations

- `effects.record` stores the exact protected-spec bytes and canonical result bytes, verifies `result.spec_sha256` against those spec bytes, preserves result/source/runtime digests, and binds exact Launchwright artifact revisions plus an optional exact scenario revision.
- `effects.inspect` rechecks result bytes, artifact bytes and all local revision pins. Drift converts an old result to `UNKNOWN`.
- A serialized canonical `PASS` remains `UNKNOWN` unless the application session has explicit `canonical_effect_admission` capability and the caller requests admission.
- An admitted canonical `FAIL` remains a failure. Launchwright never turns a waiver or a non-admitted PASS into PASS.
- A decisive PASS/FAIL result must reference every exact bound artifact digest and may not reference a digest outside the bound Launchwright artifact set.

The public Native Application surface isolates these operations in a dedicated `effects` NodeBridge profile. The profile adds no runtime execution path.

## Real acceptance lane

The manual `effects` lane in `.github/workflows/heavy.yml`:

1. checks out the exact reviewed Semwright SHA;
2. builds the real `semwright-native-effects` binary with the upstream `effects` feature;
3. produces an exact Launchwright-owned JSON artifact through the normal application dispatcher;
4. asks the upstream binary to prepare the protected spec;
5. evaluates the exact artifact with that upstream binary;
6. requires canonical result schema, `PASS`, the exact immutable-artifact scope and `execution_authority: false`;
7. reopens Launchwright with explicit owner admission and records the result through `effects.record`;
8. verifies the exact local binding through `effects.inspect`.

The workflow retains the definition, protected spec, spec digest, exact artifact, canonical result and Launchwright acceptance report as evidence.

This lane establishes integration with the canonical immutable-artifact Effects reader only. Driver Host acceptance and effect/noninterference verification for real product mutations remain separate Semwright-owned acceptance gates.
