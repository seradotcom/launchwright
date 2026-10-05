# Security boundary

Launchwright is a local, single-owner developer preview. It is not a hardened multi-tenant service. Do not expose its loopback server through an unauthenticated tunnel or reverse proxy. It must not be used as a replacement for Platform authentication, Broker policy, runtime isolation or external approval.

Report issues privately through the repository owner's preferred contact channel; do not attach credentials or product captures. Tests use only synthetic owned data and benign validation. State files and session-token files must remain outside Git and release artifacts. Imported metadata does not establish that an external tool actually executed.

Native application bundles are byte-pinned at compile time. Mounts and runtime tools are configured by the owner and enforced by the canonical Driver Host, not caller-supplied JSON. Platform SDK modules require a complete owner source lock before loading. No URL supplied in a source record is automatically fetched or executed.

Mobile package ingestion is local-only and deliberately narrower than arbitrary filesystem access: the package root and manifest/assets must be regular non-symlink files, manifest paths are relative POSIX paths contained by the package root, active document/script formats such as HTML/SVG/JavaScript are outside the allowlist, each asset is bounded to 2 MiB and a package to 8 MiB, and SHA-256 plus container metadata/dimensions are checked before the canonical `mobile.import` mutation. Imported bytes can still contain sensitive product content; keep them out of Git and do not treat their metadata as proof that a device or external runner executed.
