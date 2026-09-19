# ADR-006: Immutable legal document versions

- **Status:** Accepted target; implementation deferred to Phase 9
- **Decision:** Separate logical `document_records`, immutable
  `document_versions`, and `document_access_grants`. Each version stores SHA-256,
  detected MIME type, measured size, scan state, actor/time, and predecessor.
- **Security:** The server derives parent, firm, path, MIME, size, hash, and
  visibility; uploads are quarantined until scanning passes. Downloads remain
  short-lived signed URLs after grant evaluation.
- **Evidence:** Replacing a document changes `current_version_id`; it never
  deletes superseded evidence subject to retention or legal hold.
- **Migration/rollback:** Preserve existing objects and rows, inventory missing
  hashes, create version 1 records, reconcile, then flag-switch reads.
