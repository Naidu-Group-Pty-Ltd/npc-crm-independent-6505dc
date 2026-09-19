# Solicitor Portal — Phase 8 Brief (Compliance, Audit & Hardening)

## Scope delivered

1. **Tamper-evident audit trail**
   - `legal_matter_audit_events`: append-only, per-matter SHA-256 hash chain
     (`prev_hash` → `row_hash`) written by a BEFORE INSERT trigger.
   - `legal_audit_immutable` trigger rejects every UPDATE/DELETE.
   - Shared recorder + verifier: `supabase/functions/_shared/legalAudit.ts`.

2. **Conflict of interest register**
   - `legal_conflict_checks` stores searched terms, matches (party + matter),
     outcome and who cleared it. Search is firm-scoped and excludes the matter
     itself; matters on the same client are flagged.
   - `legal_matters.conflict_check_status` / `conflict_checked_at` mirror the
     latest result for list-level triage.

3. **File closure & retention**
   - `closure_status` (open/closing/closed/archived), `closure_checklist`,
     `closure_reason`, `closed_by_*`, `retention_class`, `retention_until`,
     `archived_at`.
   - Closure blockers computed live (settlement tasks, unsatisfied critical
     dates, unpaid disbursements, unanswered requisitions, missing conflict check).
   - Retention expiry derived from the class (7y/10y/permanent).

4. **Compliance pack export**
   - `compliance_export` assembles matter, parties, dates, tasks, documents
     metadata, searches, requisitions, disbursements, status history, conflict
     checks and the full audit trail, with chain verification attached.
   - Each export is logged to `legal_compliance_exports` and audited.

5. **Firm compliance health**
   - `compliance_health` returns severity-graded signals: conflict never run,
     unresolved conflict, settled-but-not-closed, retention elapsed.

## Surfaces

- Edge function `solicitor-portal-compliance` (verify_jwt = false, session token
  auth) — 12 operations.
- `src/lib/solicitorCompliance.ts` typed client.
- `MatterCompliancePanel` → new **Compliance** tab on the matter Deal Room.

## Guardrails verified

- Session → firm → client assignment → permission matrix on every operation.
- `audit` key gates the trail and export; `matters:edit` gates conflict and
  closure mutations.
- No financial-position or AML data enters the compliance pack (tri-portal
  separation preserved; Client and Finance portals unchanged).
- Security regression test:
  `src/security/solicitorPortalComplianceAuthz.security.test.ts` (7 assertions).
- `tsgo --noEmit` clean.
