# Canonical Effects readback and Driver Host admission

Launchwright uses the Native SDK 1.0.0 Effects surface with exact Semwright source `d2da9a495a53fe279a1ca4de61f0e24646350f22`. The vendored TypeScript package remains the published `v1.0.0` bytes from `8fa191250ae68274182570c65f067f7a60f85625`; the Rust/Host source pin advances to reviewed PR #250 so descriptor-relative Effects reads work under Driver Host/Landlock without parent-directory ReadDir authority. It does **not** implement another effects evaluator.

## Scope

The canonical evaluator is Semwright Native SDK `effects_readback`, whose scope is:

`immutable_native_sdk_artifact_properties_only`

It independently reads bounded JSON/CSV artifacts and evaluates the upstream Effect Contract for those immutable properties. Its result always carries `execution_authority:false`. That scope is intentionally narrower than native/browser/Godot mutation effects, noninterference, or authoritative `scenario.effects`; Launchwright therefore keeps scenario-mutation authority false even when the immutable-artifact evaluator is Host-isolated.

## Application operations

- `effects.inspect` remains in the read-only `effects` Native profile. It rechecks result bytes, artifact bytes and every pinned local revision. Drift turns an old decisive result into `UNKNOWN`.
- `effects.record` moves to the isolated `effects_runtime` Native profile. The normal application dispatcher and the historical `canonical_effect_admission` capability cannot self-admit a PASS.
- A PASS can become effective only when `effects.record` receives an exact, owner-granted Driver Host receipt admitted by `src/effects-runtime.mjs`. The receipt binds the protected-spec digest, exact result bytes, pinned Semwright source, provider generation/descriptor, provider executable SHA-256, canonical reader source SHA-256 and runtime digest.
- Canonical FAIL stays fail-closed. A waiver, local result, direct CLI execution or stale receipt never turns FAIL/UNKNOWN into PASS.
- A decisive result must cover every exact bound artifact digest and may not reference an artifact outside the bound Launchwright artifact set.

## R29 fixed Effects provider

`crates/launchwright-effects-driver` is a Semwright Driver SDK provider with exactly two read-only commands: a no-data probe and `driver.launchwright-effects.verify`. The verification command accepts only `spec_sha256`.

The caller cannot select an executable, code, argv, environment, network access, filesystem path, protected-spec filename or artifact root. Those are fixed by the provider and owner policy:

- protected spec mount: `effects-protected`;
- artifact mount: `effects-artifacts`;
- protected spec filename: `spec.json`;
- evaluator: the Semwright v1.0.0 `effects_readback` library linked into the reviewed provider binary.

The provider can execute the evaluator only through an authenticated Driver Host execution context. Launchwright separately binds the protected spec's declared runtime digest to the exact staged provider/evaluator executable SHA-256 before admitting a PASS.

## Exact acceptance lane

The manual `effects` lane in `.github/workflows/heavy.yml` now:

1. checks out exact Semwright v1.0.0 source;
2. builds all thirteen bounded Launchwright Native profiles plus the fixed Effects provider;
3. builds the real Semwright daemon, CLI, Driver Host sandbox helper and `semwright-native-effects` preparation CLI;
4. uses the canonical CLI only to prepare the owner-protected spec with the exact provider runtime digest;
5. executes the canonical Effects reader inside the fixed provider under Broker/Policy/Driver Host;
6. stores an exact runtime receipt in the read-only `effects-receipts` grant;
7. admits that receipt only through the isolated `effects_runtime` Native profile and requires effective `PASS`;
8. proves wrong spec digest, result substitution, runtime-digest substitution, external-authority escalation and missing provider policy all fail closed;
9. mutates a pinned Launchwright source and requires the previously admitted PASS to become `UNKNOWN`.

Before a green exact-SHA R29 CI run, this is candidate behavior only. Even after that acceptance it will establish only immutable-artifact Effects evaluation inside Driver Host. It will **not** establish native/browser/Godot mutation-effect correctness, noninterference, scenario-effects authority, Platform execution, real-customer acceptance or publication authority.
