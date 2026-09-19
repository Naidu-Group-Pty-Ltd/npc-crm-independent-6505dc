# PDF Import Production Hardening Risk Register

## Usage

Use this document to record production-readiness risks found during Phase 10A.

Do not include client PDFs, private screenshots, signed URLs, raw PII, or
confidential document contents.

## Risk Register

| ID | Domain | Risk | Severity | Likelihood | Status | Owner | Recommended Action | Target Phase | Notes |
|---|---|---|---|---|---|---|---|---|---|
| PDF-HARDEN-001 | Security/Auth |  | critical/high/medium/low/info | frequent/likely/possible/unlikely/rare | open/accepted/fixed/deferred |  |  | 10A/10B/10C/10D/10E/10F/10G |  |

## Phase 10A Recorded Findings (baseline)

These rows summarise the Phase 10A audit. Statuses reflect the source review plus
live read-only SQL. Update as actions are completed.

| ID | Domain | Risk | Severity | Likelihood | Status | Owner | Recommended Action | Target Phase | Notes |
|---|---|---|---|---|---|---|---|---|---|
| PDF-HARDEN-RLS-002 | RLS/Database | `report_templates` RLS policy set not documented from the PDF import review | high | possible | open | developer_backend | Run SQL section 13 and document `report_templates` policies | 10A | RLS is enabled (section 14) |
| PDF-HARDEN-STORAGE-001 | Storage | `template-import-artifacts` must not be public | critical | possible | fixed | developer_backend | Confirmed `public=false` via SQL section 6 | 10A | Also `pdf-import-diagnostics` private |
| PDF-HARDEN-STORAGE-002 | Storage | Artifact object paths must be scoped by import ID | high | unlikely | open | developer_backend | Confirm upload path naming embeds import ID | 10A | Verify with section 5 + code review |
| PDF-HARDEN-STORAGE-005 | Storage | `template-import-assets` and `report-templates` buckets are public | medium | possible | open | developer_backend | Confirm no private source PDFs / private rasters are written to these buckets | 10A | Expected to hold design assets / rendered outputs only |
| PDF-HARDEN-SIDECAR-003 | Sidecar | Large/complex PDF size + timeout limits are undocumented | medium | possible | deferred | developer_sidecar | Document limits using section 12 duration buckets | 10F | Sidecar out of scope for 10A |
| PDF-HARDEN-PRIVACY-003 | Data Privacy | Logs must not contain raw PDF text or PII | high | possible | open | developer_backend | Complete a focused log-scrub review of PDF import functions | 10A | Observed logging is structured metadata only |
| PDF-HARDEN-PERF-001 | Performance/Cost | AI reconciliation must be operator-triggered/governed | high | possible | deferred | developer_fullstack | Confirm no automatic per-import trigger; document cost controls | 10D |  |
| PDF-HARDEN-LEGACY-001 | Observability | Legacy failed/stale imports and imports missing Visual QA | low | frequent | accepted | operator | Triage per the monitoring runbook; not introduced by Phase 7–10 | 10A | 102 failed, 16 stale, 96 missing Visual QA |

## Severity Definitions

critical:
Production-blocking security, data exposure, or system integrity risk.

high:
Must fix before broad production rollout.

medium:
Should fix soon; may be acceptable with documented mitigation.

low:
Non-blocking improvement.

info:
Documented observation.

## Status Definitions

open:
Needs action.

accepted:
Known and accepted with mitigation.

fixed:
Resolved.

deferred:
Moved to later phase.

## Required Review Areas

- Security/Auth
- RLS/Database
- Storage
- Edge Functions
- Sidecar
- Data Privacy
- Operator Console
- Golden Regression
- Export Parity
- Observability
- Performance/Cost
- Rollout

## Final Decision

- ready
- ready_with_warnings
- not_ready

Decision: ready_with_warnings

Notes:
No critical or high failures. Score 85/100 (34 pass, 1 warning, 5 unknown, 0 fail).
Six hardening actions are open/deferred with owners and target phases. Proceed to
Phase 10B after logging the actions above.
