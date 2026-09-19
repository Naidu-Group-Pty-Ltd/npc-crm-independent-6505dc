# PDF Import Phase 9 Final Smoke Test

## Purpose

This is the final, manual smoke test that locks the Phase 9 PDF import rollout. It
verifies that the whole Phase 9 system — orchestrator, operator console, history,
baseline comparison, export parity automation, release gates, and monitoring —
loads and behaves correctly against the live application before a production
rollout decision is made.

It is deliberately conservative: it validates behaviour without mutating
production data beyond the existing operator/orchestrator flows, and it never runs
destructive SQL.

## Pre-conditions

Before running the smoke test:

- You are on the Phase 9 branch (or a merge of it) with a clean working tree.
- `npm install` has completed.
- You can sign into the app with an operator account.
- You have access to the Supabase SQL Editor for project `dduzbchuswwbefdunfct`
  (read-only queries only).
- No private PDFs, client PDFs, screenshots, generated PDFs, audit outputs, logs,
  `.env`, `dist`, or `node_modules` are staged for commit.

## 1. Local validation (no database)

Run the Phase 9E release check and the Phase 9G final local check:

```bash
bash scripts/regression/pdf-import-phase-9-release-check.sh
bash scripts/regression/pdf-import-phase-9-final-local-check.sh
```

Record:

- release check result (PASS / FAIL)
- final local check result (PASS / FAIL)
- monitoring + release gate test result
- `npm run build` result

All four must pass (or pass-with-documented-warnings) to continue.

## 2. Database validation (read-only SQL)

In the Supabase SQL Editor, run — in order — and record the final decision row of
each:

1. `scripts/regression/pdf-import-phase-9e-release-gate-check.sql`
2. `scripts/regression/pdf-import-phase-9f-monitoring-check.sql`
3. `scripts/regression/pdf-import-phase-9-final-check.sql`

Record from the final check:

- Section 5 — database object readiness (all core objects present).
- Section 7 — monitoring snapshot decision.
- Section 8 — release gate DB readiness.
- Section 9 — production attention rows (how many, and why).
- Section 10 — the final Phase 9 database rollout decision string.

These queries are read-only. Do not run any write, update, delete, or DDL from the
SQL Editor as part of this smoke test.

## 3. Browser validation (manual)

Sign in and validate the operator-facing flow:

1. Open `/admin/pdf-golden-regression`. The Golden Regression console loads with no
   console errors.
2. The corpus selector loads and lists the canonical corpus items.
3. Enter a known good import ID.
4. Run **Evaluate Only**. The result panel shows a status, the quality gate panel
   shows gates, and the triage panel shows recommendations.
5. If evidence allows, enable the **export parity automation** option and confirm
   it appears and runs (or reports `manual_required` where evidence is missing).
6. Run **Evaluate + Persist** when it is safe to do so. The history save result
   displays and the baseline comparison displays (`no_baseline` is acceptable for a
   first run).
7. Open the Template Import Quality dashboard. It still loads and the deep-link to
   the Golden Console works.
8. Confirm there are no uncaught console errors across the flow.

## Required evidence to record

Capture the following in the rollout record (not committed to the repo):

- release check result
- final local check result
- monitoring + release gate test result
- build result
- Phase 9E SQL decision
- Phase 9F SQL decision
- Phase 9 final SQL decision (section 10 string)
- number of production attention rows (section 9) and their reasons
- browser smoke result (pass / fail) with any console errors
- private-artifact staged check (must be clean)
- final production rollout decision (`production_ready`,
  `production_ready_with_warnings`, or `production_blocked`)

Do not attach private PDFs, generated PDFs, client data, or screenshots of private
documents to the rollout record.

## Failure handling

- **Build or required tests fail** → `production_blocked`. Fix before rollout.
- **Local release script fails** → `production_blocked`. Fix before rollout.
- **Final SQL returns `production_blocked_database` or
  `production_blocked_missing_database_objects`** → `production_blocked`.
  Investigate the missing object or blocking rows; do not roll out.
- **Monitoring returns `critical_alerts_present` or `release_blocked`** →
  `production_blocked`.
- **Console crashes, persistence fails, or the runner crashes** →
  `production_blocked`.
- **Only acceptable warnings remain** (no live golden history yet, partial corpus
  coverage, `no_baseline` first run, `warnings_present` monitoring, export parity
  Level 3 unavailable) → `production_ready_with_warnings`. Document each warning in
  the rollout record and proceed with the controlled rollout.
- **Everything clean** → `production_ready`.

See `phase-9-completion-checklist.md` for the full decision definitions and
`phase-9-production-rollout-notes.md` for the controlled rollout order.
