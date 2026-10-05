# Godot source profile

Launchwright treats Godot as the reviewed second non-browser source model for the current R6 extensibility pass. It does not fall back to a generic shell or arbitrary GDScript execution.

## Reviewed runtime contract

The application profile is pinned to:

| Component | Pin |
| --- | --- |
| Semwright source | `4d291de26724810017ce7b6d185326514cb79fa6` |
| Semwright Godot driver | `godot` / `0.9.0-dev.1` |
| Driver protocol declared by the reviewed manifest | `5` |
| Godot engine | `4.7.2` |
| Linux x86_64 engine SHA-256 | `8d106cbe6144c2dc7e881d61d2429c1a8a76e6b22ef48bd5e48dcf934953f71e` |

These values are application compatibility pins. They are not credentials, driver installation state or proof that a runtime executed.

A Godot Source uses a logical locator of the form `godot://project/<id>`. Host filesystem paths, executable paths and pairing secrets are deliberately absent from the Launchwright Source record.

## Preflight

`profile.preflight` for `godot` fails closed unless all of the following are true:

1. the Source is type `godot`;
2. its purpose is approved;
3. its build matches the Release selected by the Target;
4. native execution authority is explicitly declared by the owning runtime;
5. the Source locator is a bounded logical Godot project identifier; and
6. Semwright, driver and engine pins exactly match the reviewed runtime contract.

The same preflight is exposed through the canonical Native SDK bridge. `profile.matrix` and `profile.preflight` live in the `core` bridge profile so the mobile/localization integration bundle keeps material headroom below the canonical 48 KiB NodeBridge limit.

A PASS means the application contract is ready to be handed to the owning Semwright runtime. It is not a substitute for Broker policy, project pairing, Host mounts, native receipts or engine execution evidence.

## Real-engine CI lane

The manual `godot` lane in `.github/workflows/heavy.yml` runs only on a disposable GitHub runner. It:

1. checks out the exact reviewed Semwright commit;
2. pins Rust 1.98.1;
3. downloads Godot 4.7.2 from the official Godot release and verifies the exact binary SHA-256;
4. builds the production `semwright-godot-driver`;
5. runs Semwright's real-editor `e2e_real.py` acceptance against that engine;
6. requires semantic scene inspection, project validation, bounded runtime testing and PCK export in the resulting trace; and
7. feeds the observed Semwright/Godot pins back into Launchwright's Godot preflight and retains a machine-readable evidence record.

The retained Launchwright record intentionally states:

- `cross_system_real_engine: true` only after that lane completes;
- `platform_receipt_admitted: false`;
- `launchwright_capture_admitted: false`; and
- `driver_host_isolation_accepted: false`.

Those latter states require their own evidence paths and must not be inferred from a successful real-engine driver exercise.

## Security boundary

The reviewed Semwright Godot driver exposes typed `driver.godot.*` capabilities and does not expose arbitrary shell execution, `OS.execute`, unrestricted object-method invocation or arbitrary GDScript evaluation. Launchwright preserves that boundary.

The `cli` source profile is therefore deliberately marked unavailable for native execution in this reviewed snapshot. A caller cannot make it executable merely by declaring local shell authority. CLI support can be enabled later only when a reviewed canonical provider exists and is pinned through the same compatibility/evidence model.
