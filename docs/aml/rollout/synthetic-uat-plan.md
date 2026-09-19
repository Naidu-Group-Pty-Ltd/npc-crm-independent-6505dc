# Synthetic UAT plan (E6) — status: NOT RUN (staging blocked)

26 scenarios; each records executor, date, environment, result and
evidence. **Every scenario is currently NOT RUN** — execution requires the
non-production stack this environment cannot provide (see
`controlled-rollout-runbook.md` §Staging). The API-level automations for
S10–S14, S22, S24–S26 live in
`tests-e2e/aml-partner-pilot/syntheticPilot.e2e.ts` and SKIP (recorded as
NOT RUN, never as passed) without `AML_PILOT_BASE_URL`.

| # | Scenario | Key assertions | Result |
|---|---|---|---|
| S01 | Individual, documentary verification; finance relies on current passport | attestation view; procedures visible; no risk content | NOT RUN |
| S02 | Joint purchasers — one late, one name discrepancy | origin workflow unaffected by partner view; discrepancy never partner-visible | NOT RUN |
| S03 | Company — layered ownership, owner clarification | ownership evidence only via controlled request; workspace shows procedures only | NOT RUN |
| S04 | Trust/SMSF — corporate trustee, appointor, parties | multi-party attestation renders; no structure detail beyond sanitised facts | NOT RUN |
| S05 | Biometrics declined → documentary route | no penalty; no biometric object exists; verification outcome recorded | NOT RUN |
| S06 | Sharing declined | origin continues; partner sees independent-CDD guidance; no origin block | NOT RUN |
| S07 | No arrangement | grant blocked (`grants` gate + eligibility guard); independent CDD available | NOT RUN |
| S08 | Overdue assessment | reliance blocked; remediation task shown; origin gate unchanged | NOT RUN |
| S09 | Construction-only builder | never assumed regulated; configured operational info only | NOT RUN |
| S10 | Solicitor P3 authority document | short-lived URL ≤300 s; reason logged; privilege boundary intact | NOT RUN |
| S11 | P4 delivery rejected | `classification_not_deliverable`; no path/bucket in response | NOT RUN |
| S12 | P5 delivery rejected | same | NOT RUN |
| S13 | P6 biometric delivery rejected | same; biometric never partner-accessible | NOT RUN |
| S14 | Material change | old content withheld everywhere; grants refresh/revoked per policy; determination refresh-required; safe wording only; gate unchanged | NOT RUN |
| S15 | Provider outage | attempt not consumed; retry/manual path | NOT RUN |
| S16 | Stale sanctions source | no "clear" result; readiness + incident state | NOT RUN |
| S17 | Outbox temporary failure | retry, no duplicate outcome | NOT RUN |
| S18 | Stale/replayed event | revoked stays revoked | NOT RUN |
| S19 | Legal hold | disposal blocked; reason invisible to partner | NOT RUN |
| S20 | Failed disposal | pointer preserved; failure evidence retained | NOT RUN |
| S21 | Cross-tenant attack | denied | NOT RUN |
| S22 | Cross-organisation attack | denied | NOT RUN |
| S23 | Wrong matter/project/file assignment | denied | NOT RUN |
| S24 | Suspended membership | denied before data loads | NOT RUN |
| S25 | Expired/revoked delivery | fresh access refused | NOT RUN |
| S26 | Developer standalone route | fail-closed | NOT RUN |

DB-layer analogues that DID run locally (rehearsal harness): S17/S18
(duplicate-enqueue collapse, replay reset, revocation irreversibility),
S14's transactional core (flag/obligation/event idempotency), S11–S13's
structural CHECKs, S21/S22's RLS denial layer, and the flag-order +
rollback drills. These are recorded as DATABASE-LAYER evidence only — they
do not substitute for the end-to-end run.
