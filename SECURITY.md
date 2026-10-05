# Security boundary

Launchwright is a local, single-owner developer preview. It is not a hardened multi-tenant service. Do not expose its loopback server through an unauthenticated tunnel or reverse proxy. It must not be used as a replacement for Platform authentication, Broker policy, runtime isolation or external approval.

Report issues privately through the repository owner's preferred contact channel; do not attach credentials or product captures. Tests use only synthetic owned data and benign validation. State files and session-token files must remain outside Git and release artifacts. Imported metadata does not establish that an external tool actually executed.

Native application bundles are byte-pinned at compile time. Mounts and runtime tools are configured by the owner and enforced by the canonical Driver Host, not caller-supplied JSON. Platform SDK modules require a complete owner source lock before loading. No URL supplied in a source record is automatically fetched or executed.
