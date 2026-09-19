# Builder Portal — Release Readiness Programme Index

Produced on `claude/builder-portal-release-readiness-2avkat` from
`origin/main` = `39cfb4b7dca1409865e469aa5fdb79fada2fe7f6`.

**Outcome: Completion Condition C — verified external blocker (no staging environment), with
Condition B (no staging write authorisation given).** All non-blocked work is complete.

**Production `dduzbchuswwbefdunfct` received no writes, no deployments, no secret changes, no
storage changes, no synthetic data and no rollout changes.**

---

## Documents

| # | Document | Covers |
|---|---|---|
| 30 | [Release readiness report](./30-release-readiness-report.md) | Steps 1–2, 22 · baseline, implementation verification, defects, validation results, residual risks |
| 31 | [Solicitor parity report](./31-solicitor-parity-report.md) | Step 3 · routing, chrome, governance, page experience, onboarding tour |
| 32 | [Backend parity report](./32-backend-parity-report.md) | Step 4 · 27 backend release-architecture items, each classified |
| 33 | [Security and document safety review](./33-security-and-document-safety-review.md) | Steps 5–6 · auth, request security, authorization, database, mutations, data boundaries, documents, messaging |
| 34 | [Controlled rollout architecture](./34-controlled-rollout-architecture.md) | Steps 7–10 · gap assessment, state definitions, readiness specification, Command Centre controls |
| 35 | [Production read-only reconciliation](./35-production-read-only-reconciliation.md) | Step 12 · migration history, schema, function inventory, anomalies |
| 36 | [Deployment manifest](./36-deployment-manifest.md) | Step 13 · database, Edge Function, secret, storage, worker and rollout manifests |
| 40 | [Staging deployment checkpoint](./40-staging-deployment-checkpoint.md) | Steps 14–15 · staging determination, exact deployment set, risks, **authorisation request** |
| 41 | [Production deployment runbook](./41-production-deployment-runbook.md) | Step 23 · not executed |
| 42 | [Pilot checklist](./42-pilot-checklist.md) | Step 23 · pilot workflow |
| 43 | [Rollback runbook](./43-rollback-runbook.md) | Step 24 |

## Not produced, and why

| Document | Reason |
|---|---|
| Staging deployment report | No staging environment. Nothing was deployed |
| Staging browser-test report | No deployed staging application to drive a browser against |
| Security-isolation report (deployed) | Isolation is proven locally against live PostgreSQL and by contract tests; the **deployed** isolation run needs staging |

These are absent rather than written from local results, because a report titled "staging" that
describes local runs would misrepresent what was proven.

---

## Blockers

| # | Blocker | Effect |
|---|---|---|
| ~~B1~~ | ~~Builder documents are neither quarantined nor malware-scanned~~ | **RESOLVED** — `20260810000200`. Now gated on the scanner provider secrets instead |
| **B2** | Builder notifications have no outbox, retry or dead-letter path | Accepted while no Builder notification leaves the database (R3) |
| **B3** | 19 duplicate migration versions repository-wide | Pre-existing; forces an explicit deployment list instead of `db push` |
| ~~B4~~ | ~~Builder migrations inseparable from 19 unrelated pending migrations~~ | **NOT TRUE** — read-only inspection confirms every Builder dependency already exists in production. Builder deploys standalone |
| **R2** | No staging environment | Steps 16–21 blocked; the cookie/origin model is unproven |

## Where execution resumes

[`40-staging-deployment-checkpoint.md`](./40-staging-deployment-checkpoint.md) §3 lists exactly
what must be supplied; §4 onward is ready to execute unchanged.
