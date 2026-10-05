# Storage and portability

Launchwright uses SQLite plus content-addressed blobs inside one local state directory. The database schema is migrated only explicitly; startup does not silently reinterpret an unknown schema.

A portable snapshot is JSON with a SHA-256 digest over the snapshot payload. It contains domain entities, immutable blob bytes, alias history, pending records and audit events. It also exports historical request receipts for audit/forensic purposes.

Restore is deliberately asymmetric:

- stable domain IDs and resource revisions are retained;
- exact blob hashes are rechecked before insertion;
- the workspace receives a new generation;
- the request epoch advances;
- historical mutation receipts are **not** activated;
- uncertain work/pending records become `RESTORE_RECONCILE_REQUIRED`;
- an explicit `workspace.restore` audit event is appended.

This prevents an offline backup from becoming authority to replay a mutation or external publication after restore.

Snapshots contain application content and may be sensitive. Keep them private, do not commit them, and apply host filesystem encryption/backup policy appropriate to the material.
