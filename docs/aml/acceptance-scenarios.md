# AML Acceptance Scenarios (report §22)

Baseline scenarios executed before advancing rollout stages. The MLRO can add tenant-specific scenarios in
**Admin → AML/CTF → Launch Ops → Acceptance**. Run results are recorded there and referenced in the release gate.

| Code | Phase | Title | What it proves |
| --- | --- | --- | --- |
| AS-01 | 3 | New client onboarding end-to-end | Portal intake → verification → risk score → open case |
| AS-02 | 4 | PEP + sanctions match handling | Screening hit → analyst review → decision → audit trail |
| AS-03 | 5 | Risk rating recalculation | Risk model reruns when profile changes; audit shows both scores |
| AS-04 | 6 | Beneficial-owner request flow | Counterparty request → response → verification |
| AS-05 | 7 | Finance-portal handoff | Client passes AML → visible to finance portal without leaking case content |
| AS-06 | 8 | Transaction ingest & threshold flag | TTR-eligible transaction detected; alert created |
| AS-07 | 9 | Continuous monitoring rescreen | Cron rescreen re-fires match; alert opened; EDD case created |
| AS-08 | 10 | SMR / TTR draft → MLRO sign-off | Report authored → hash-chained version → MLRO decision recorded |
| AS-09 | 11 | Retention hold + disposal | Legal hold blocks disposal; released hold triggers scheduled deletion |
| AS-10 | 12 | Tenant branding + entitlements | Terminology overrides respected; locked keys refused |
| AS-11 | 13 | Step-up + AI approval gate | Reporting requires step-up; AI write proposal blocked without MLRO approval |
| AS-12 | 14 | Rollout advance requires gate PASS | broad_production advance refused with a failing release gate |
| AS-13 | X | Tri-portal regression | Command Centre / Client Portal / Finance Portal core flows untouched by AML |

Each scenario should be seeded once and re-run when its phase surface changes. Failed runs block the next stage advance.
