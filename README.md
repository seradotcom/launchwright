# Launchwright

**A source-linked release workspace built on the canonical Semwright Native SDK.**

Launchwright keeps release briefs, target contexts, scenarios, claims, immutable editorial outputs, exact-candidate reviews and private draft delivery in one application-owned record.

This is a **developer preview**, not a claim that the full Release Studio specification has passed acceptance. The current local implementation is useful for editorial release preparation. Browser/product capture, Composition video rendering, canonical effects admission, multi-user Platform approvals and external publishing are not represented as completed capabilities.

## Run

Use Node **24.21.0** (the Native SDK's declared supported engine) and npm. No Rust compilation, browser installation, renderer or runtime build is needed for the local text workspace.

```sh
npm ci --ignore-scripts --no-audit --no-fund
node src/main.mjs init
node src/main.mjs serve
```

Open `http://127.0.0.1:4317`. Unlock with the contents of `.state/session-token`; keep that file private. The service binds loopback only, does not accept query-string credentials, and rejects unexpected Host and Origin headers.

An empty workspace is the default. To add **explicitly synthetic editorial examples**, not fabricated captures:

```sh
node src/main.mjs demo
```

## Implemented local workflow

Create a product and build-pinned release. Define separate UI/editorial/audio locales, plan, role, flags and viewport. Declare sources and scenarios; import provenance without turning producer assertions into technical PASS. Write a deliverable and generate immutable Markdown, safe HTML, JSON, email-draft or VTT output. Version ChannelProfiles, freeze exact artifact hashes, source/profile versions, destination and review contract, and record technical/editorial/permissions decisions independently. Export deterministic private ZIP bytes or record a reviewed private draft under a compare-and-swap alias. For non-export channels, prepare a durable DeliveryAttempt that pins the candidate, ChannelProfile and logical request; transport acceptance, destination observation, reconciliation and withdrawal remain distinct states, and lost acknowledgements never trigger an automatic resend. Exported, privately delivered and externally published are separate states; this local workflow itself sends nothing to an external service.

The UI, public HTTP client, CLI and native bridge share the same application dispatcher and SQLite transactions. Durable request receipts, events and business writes commit together. Large revisions remain strings. A changed request under an old idempotency key conflicts. A lost reply is recovered, never silently replaced with another mutation. Portable workspace ZIP export/restore verifies CRC/SHA-256, rotates workspace generation and intentionally excludes session tokens, mutation receipts and outstanding dispatch state.

## Actual Semwright integration

The **unmodified** `@semwright/native-sdk` source is vendored under its original MIT OR Apache-2.0 license, pinned by hashes in `SOURCE_LOCK.json`. Current pin: Semwright commit `4d291de26724810017ce7b6d185326514cb79fa6`, SDK `0.9.0-dev.1`. This was checked through the authenticated GitHub API; the native SDK subtree is unchanged from the earlier `04cf0ef…` source archive used to begin implementation.

`src/native-entry.mjs` implements the public `NativeApplication` interfaces and uses `bridgeEntrypoint`, `dispatchApplication`, version-bound observations, exact request digests and recovery. `crates/launchwright-native` is a thin **real Rust NativeDriver + NodeBridge** adapter. Its JS bundle hash is fixed at build time; callers cannot select executable code, mounts or the Node runtime. Rust, browser and Host builds belong to the heavy GitHub Actions lane.

The optional Platform integration loads an **owner-provided, byte-pinned** `@semwright/platform-client` package; its current source snapshot is UNLICENSED and is therefore **not redistributed here**. The adapter negotiates actual actions, stores the canonical exported pending request before its one permitted send, and uses canonical recovery. It is not another scheduler, authentication system, Graph authority or publication backend.

## Verification

```sh
npm test                 # Small isolated application / HTTP / SDK tests
node scripts/verify.mjs   # Source locks and syntax
node src/main.mjs doctor  # Actual local capability and engine report
```

GitHub Actions runs the application checks on Linux, Windows and macOS. Dispatch **Native and browser acceptance** with `lane=native`, `browser` or `all` for the expensive work. Browser tests exercise the real Launchwright interface, not product-capture acceptance. Bundle tests do not by themselves establish Driver Host isolation. See `evidence/` and `docs/ACCEPTANCE.md` for precisely recorded execution status.

## Safety and support boundaries

One local owner, one workspace. No remote access, SaaS tenant isolation or team role claim is implied. Imported evidence remains unverified. Local editorial approval never overwrites technical verification. Text formatting is not Composition rendering. Input-pin comparisons are not canonical Project Graph verdicts. Historical LTS bindings retain their artifact versions. Direct public-channel delivery is blocked.

See `docs/INSTALL.md`, `docs/ARCHITECTURE.md`, `docs/NATIVE_SDK.md`, `docs/CHANNELS.md`, `docs/SDK_GAPS.md`, `docs/RUNBOOK.md` and `docs/ACCEPTANCE.md`.

## License

New Launchwright code: **AGPL-3.0-only**. Canonical Semwright SDK files retain **MIT OR Apache-2.0** and their original notices. The private source specification and Platform source are not part of this public repository. No font binaries, credentials, private runtime state, browser profiles or source captures are included.
