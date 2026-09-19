# Pilot sign-off register (E12) — controlled document

**No sign-off below has been obtained. Every row is an open release
blocker.** Sign-offs are recorded by the named human approver only —
nothing in this register may be filled in by automation, and a missing
sign-off is never inferred, assumed or defaulted.

Each entry requires: approver name, role, scope approved, date, evidence
reviewed, decision (approve / approve-with-conditions / reject),
conditions, unresolved items acknowledged, expiry/review date.

| # | Sign-off | Scope | Status |
|---|---|---|---|
| 1 | Product owner | rollout scope, portal surfaces, pilot plan | **NOT OBTAINED** |
| 2 | Security | evidence-access model, action-flag gates, registry state, incident runbook | **NOT OBTAINED** |
| 3 | Privacy | P1–P6 classifications, raw-ID/biometric necessity handling, retention schedule audit, access logging | **NOT OBTAINED** |
| 4 | MLRO / compliance | record classifications, retention schedules, arrangement/eligibility configuration, decision register items | **NOT OBTAINED** |
| 5 | Legal | controlled-document alignment, s 37A/s 123 posture, unresolved classifications | **NOT OBTAINED** |
| 6 | Operations / support | queues ownership, SLA targets, escalation matrix, training pack | **NOT OBTAINED** |
| 7 | Infrastructure / deployment owner | staging identification, migration/function deployment, worker schedule, rollback ownership | **NOT OBTAINED** |
| 8 | Finance pilot compliance owner | finance-surface pilot scope and boundaries | **NOT OBTAINED** |
| 9 | Builder pilot compliance owner | builder/developer-surface pilot scope and boundaries | **NOT OBTAINED** |
| 10 | Solicitor pilot compliance owner | solicitor-surface pilot scope, privilege boundary | **NOT OBTAINED** |

Prerequisite reading per approver: the Phase 0–8 reports, this rollout
pack, `docs/aml/retention-schedule-audit.md`, and
`legal-mlro-decision-register.md` (whose open items block sign-offs 3, 4
and 5 until resolved).
