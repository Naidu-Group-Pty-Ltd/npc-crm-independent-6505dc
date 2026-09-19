# PDF Import Cleanup Review Runbook

A **template** for reviewing a dry-run retention/cleanup candidate. Phase 11E is
dry-run only — nothing is deleted, archived, or compacted. Do not paste private
client data, raw PDF/OCR text, or signed URLs into this runbook.

## Candidate

Retention Event ID:

Domain:

Decision:

Safety Level:

Scope:

## Review Checklist

- [ ] Candidate does not reference an active template.
- [ ] Candidate is not tied to an unresolved monitoring alert.
- [ ] Candidate is not required for a golden baseline / regression.
- [ ] Candidate is not required for manual review.
- [ ] Candidate does not contain a source PDF that must be retained.
- [ ] Candidate has no legal/client retention requirement.
- [ ] Cleanup is dry-run only in Phase 11E.

## Recommended Action

- retain
- reject cleanup
- approve for future cleanup
- block cleanup
- investigate missing reference

(Approving a `delete_candidate` that is `requires_developer_approval` requires a
developer_admin / superadmin.)

## Notes

## Reviewer

## Date
