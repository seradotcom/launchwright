# Migration and upgrade protocol

Launchwright uses an application-owned SQLite state directory for local development/owner operation, not a replacement shared Platform datastore.

1. Record the currently installed version, Node engine, SOURCE_LOCK.json source SHA and the clean checkout SHA; stop ongoing local writers and external senders. Do not assume the working tree equals origin/main.
2. Back up the state using the documented exact portable snapshot: node src/main.mjs snapshot --state <PRIVATE_STATE> --out <PRIVATE_JSON>. Use a private destination; snapshots may contain proprietary input/receipt metadata and are **not** included in the public source ZIP.
3. Verify backup checksums, source SDK compatibility and doctor. A historical session token, tenant ACL, source credential or live work reservation is not a portable grant.
4. Review the explicit history migration and run node src/main.mjs migrate-history --state <DIR> only when doctor reports a migration prerequisite. Do not apply migration opportunistically without a backup and a migration report.
5. Restore to a **new state directory** with node src/main.mjs restore --snapshot <PRIVATE_JSON> --state <NEW_DIR>; doctor that state. Restoration advances request epochs/generation so old mutation receipts are not silently reactivated.
6. Reauthorize local accounts, external sources and destination profiles on the new machine; check all candidate, source, channel and Native SDK pins before any resumed work. An ambiguous remote outcome requires exact receipt readback, never a blind resend.
7. Run acceptance-launcher light, local browser if its tooling is installed, and the selectively applicable GitHub Actions heavy lanes for the exact new SHA. Keep old and new state directories until the operator verifies reconciliation.

## Contract limits

The implemented local history is versioned and supports the existing v1-to-v2 migration/snapshot restore contracts. This guide does **not** certify arbitrary historical versions, distributed PostgreSQL migrations, cross-tenant Platform storage or customer production cutover. Preserve independent backup/rollback evidence and require upstream support when the Native SDK wire protocol changes.
