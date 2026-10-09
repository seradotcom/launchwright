# Ownership, authorization and change control

- **Application owner:** Launchwright repo, its resource/revision schemas, local transaction/event journal, explicit UI, public HTTP client and optional local MCP adapter. All writes must pass the existing Native SDK application dispatcher.
- **Semwright Core/Broker/Driver Host:** native OS/application observations, policy-approved execution, sandbox/driver isolation and effect custody. No Launchwright local record can impersonate this authority.
- **Semwright Platform:** shared identity/tenancy, worker jobs, billing/metering, entitlement, projects, budget, artifact ACLs and *real* Publish deployment/invocation. Launchwright may consume only versioned, proven interfaces.
- **Operator:** source, intellectual-property rights and credentials; source OAuth device/app login; human editorial and publisher approval; external channel configuration; billing and customer acceptance. Authorization of an operator account is not a fixture.
- **Independent QA:** negative controls, runner artifacts and exact source SHA and environment. QA failures are preserved and escalated; never fix expected assertions to conceal an implementation defect.

Each new wave works in a separate branch/worktree from fetched origin/main, with source pin, affected interfaces, independent tests, CI per SHA, authorized PR review and a distinct documentation closeout. Do not edit other agents' worktrees or overwrite Git, source archives, release tags or user files. No external account, public release, app-store upload or live customer credential is used merely to turn a dashboard green.

R0–R8 are phases of the same application: R0 inventory, R1 Native app, R2 capture, R3 output, R4 impact, R5 review, R6 extensibility, R7 Publish, R8 QA/transfer. A completed local R35/R38 wave is not completion of any entire phase without its mandatory profile gates.

Private master specification documents are operator-owned and excluded from this public repository. Technical docs here contain only public-safe derived status and exact test/evidence identifiers.
