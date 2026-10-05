# Storage and portability

Launchwright uses SQLite plus content-addressed blobs inside one local state directory. The database schema is migrated only explicitly; startup does not silently reinterpret an unknown schema.

Portable snapshot v2 is JSON with a SHA-256 digest over the snapshot payload. It contains domain entities, exact stored entity revisions, migration provenance, immutable blob bytes, alias history, pending records and audit events. It also exports historical request receipts for audit/forensic purposes. Snapshot v1 remains accepted for restore, but because it never carried exact entity-history rows, only its current entity revisions are archived and earlier history is explicitly recorded as NOT_RECONSTRUCTED.

Restore is deliberately asymmetric:

- stable domain IDs, current resource revisions and every exact history row present in v2 are retained;
- exact blob hashes are rechecked before insertion;
- the workspace receives a new generation;
- the request epoch advances;
- historical mutation receipts are **not** activated;
- uncertain work/pending records become `RESTORE_RECONCILE_REQUIRED`;
- an explicit `workspace.restore` audit event is appended.

This prevents an offline backup from becoming authority to replay a mutation or external publication after restore.

Snapshots contain application content and may be sensitive. Keep them private, do not commit them, and apply host filesystem encryption/backup policy appropriate to the material.
