# Discovery report — master-scope reconciliation

**Baseline inspected:** Launchwright origin/main at 5cc738d5d5c47f73d8216093b068c874c18fbabe (2026-10-08). R38 separate MCP implementation subsequently merged; validate every downstream result against its own Git SHA. This is a technical inspection, not a software-release acceptance.

**Specification basis:** The privately supplied Semwright Release Studio / Launchwright master dated 2026-10-02. Its detailed source package is private and must not be copied into this public repository. Only IDs, profile names and non-sensitive contract boundaries are reflected here.

## Source locks and actual interfaces

- Launchwright application: Node >=24.21.0 <25, AGPL-3.0-only, application-owned SQLite local transaction journal, public HTTP Client SDK, Native Application adapter and optional local stdio MCP.
- Native SDK: canonical Semwright v1.0.0. The reviewed native/Driver Host Semwright source SHA is d2da9a495a53fe279a1ca4de61f0e24646350f22. The original published TypeScript package is pinned separately by SOURCE_LOCK.json.
- Core/Platform are not reconstructed or assumed available in-process. The reviewed Semwright source does not expose a canonical ProductVersion Publish deployment/invocation API; the app's Publish contracts are explicitly *local rehearsals*.
- Local and remote acceptance are separate. Synthetic owned browser/Composition/Godot/Effects/Verifier/Extension receipts do not establish a new customer's consent, the ChatGPT host, app-store upload, multi-tenant deployment or general verifier truth.

## Product inventory and unmet master gates

The original master covers 196 versioned requirement IDs in 22 modules and 36 E2E scenarios. The current public ID-only index references 21 distinct E2E IDs, not all 36. That index cannot be used as a source for claiming 196 individual accepted requirements.

The authoritative implementation-gaps view is CAPABILITY_MATRIX.md; underlying machine-readable source is docs/master-profiles.json. The aggregate master gate is BLOCKED until CORE implementation, profile-specific E2E evidence, scenario and authorization requirements are satisfied. Partial results remain useful for incremental work but do not change that state.

High-priority remaining CORE work includes: a usable Git docs PR adapter (not just a Git observation), a reproducible editable deck/PDF export, a sanitized navigable interactive product demo, store-specific packages, second-format and editorial video acceptance, and a source-change → cross-output revised release that proves selective/full rebuild and LTS historical safety. General customer capture remains separately gated. Canonical private Platform Publish depends on upstream public contracts and actual job/entitlement/output authorization, not local schema invention.

External-acceptance profiles remain distinct: Android/iOS execution and store uploads need real authorized device/accounts; the Plugin/ChatGPT host needs an installed host interaction receipt. The local R38 MCP client is an independent transport test, not host acceptance.

## Risk and work sequencing

1. Protect source/consumer/platform boundary and record the exact baseline SHAs.
2. Finish remaining CORE output/destination adapters and their real synthetic fixture E2Es.
3. Extend scenario coverage with strict negative oracles; never promote UNKNOWN by copying expected assertions.
4. Request versioned upstream Platform Publish/tenant contracts from the Semwright owner. Integrate only their real APIs after publication/conformance tests.
5. Run authorized external pilot/customer/host/device/account acceptance without reusing fixture credentials, data or inflated authority.
6. Package only reviewed committed source, exact receipts and license notices; preserve private specifications and operator tokens outside the public repo.

No tests, run IDs or raw acceptance screenshots in this document constitute new execution. Verification and the active gate live in docs/ACCEPTANCE.md, exact evidence/rNN receipts and the scripts/master-acceptance.mjs output.
