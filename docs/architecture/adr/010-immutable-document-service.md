# ADR 010: Immutable, scanned legal document versions

- **Status:** Accepted for Phase 9
- **Date:** 2026-07-30

## Context
The legacy register updates one document row and deletes the previous storage object. It trusts browser-declared MIME and size, so version numbers do not provide an evidentiary chain or safe download boundary.

## Decision
A `document_record` is the logical item; every uploaded object is a distinct, immutable `document_version`. The server generates the storage path. A trusted processor downloads the object, reads its actual size, detects content by signature, computes SHA-256, and invokes a configured malware scanner. Only a clean version may become `available` or receive a signed download URL.

Audience access is an explicit, revocable `document_access_grant`. Revoking a grant never deletes the record or version. Every download writes `document_download_audit`. Ordinary deletion of a version is database-forbidden, including superseded versions and versions under legal hold.

Legacy objects are backfilled as `legacy_unverified` and quarantined for scanning. `IMMUTABLE_DOCUMENTS_V2` is opt-in until migration reconciliation and scanner configuration pass; disabling it restores the legacy adapter without deleting new evidence.

## Consequences
- Version 1 remains retained after version 2 becomes current.
- Browser MIME, size, parent IDs, paths and scan results are never authoritative.
- Scanner unavailability fails closed and remains visible as a retryable processing job.
- Phase 10 can expose client-approved versions directly, without copying objects into `client_files`.
