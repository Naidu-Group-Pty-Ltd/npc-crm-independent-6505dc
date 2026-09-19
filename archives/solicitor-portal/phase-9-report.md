# Phase 9 delivery report — immutable document service

## Architecture and migration
The additive migration creates logical document records, immutable versions, audience grants, processing jobs, download audit and migration issues. Legacy document rows and objects remain in place. Linked legacy documents are backfilled deterministically; uploaded objects are quarantined as unverified until scanned.

## Processing and access
The server generates scoped object paths. The processor downloads bytes from storage, enforces actual size, rejects executable/unknown signatures, detects MIME, computes SHA-256 and invokes a timeout-controlled malware scanner. Only clean versions become downloadable. Superseded versions remain retained.

Solicitor and Client APIs use case- and matter-scoped authorization plus explicit grants. Client responses are whitelisted and never disclose storage paths or scanner internals. Every signed download records a trusted audit row.

## Rollback and risks
`IMMUTABLE_DOCUMENTS_V2` is opt-in. Set it to anything other than `true` to use the legacy adapter. Production enablement requires a configured scanner, successful legacy rescan, resolved case-link issues and zero downloadable non-clean versions.

## Follow-up
Phase 10 renders these client-granted versions in the Legal Workspace. Phase 13 binds AI analysis to immutable version hashes. Phase 15 removes mutable legacy attachment fields only after reconciliation.
