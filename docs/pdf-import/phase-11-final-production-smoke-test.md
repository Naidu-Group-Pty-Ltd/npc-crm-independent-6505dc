# PDF Import Phase 11 Final Production Smoke Test

## Purpose

This smoke test validates the PDF import production rollout surface end-to-end.

## Preconditions

- Phase 10 locked or locked_with_warnings.
- Phase 11A–11G complete or ready_with_conditions.
- Safe test import available.
- Admin/developer role available.
- No sensitive client PDF required.

## Commands

```
npm run build

npm run pdf-import:release-gate

npm run preview -- --host 0.0.0.0 --port 8080
```

## Smoke Test Flow

### Step 1 — Golden Regression Console

Open:

`/admin/pdf-golden-regression`

Expected:
- page loads
- permissions visible
- Evaluate Only available to allowed role
- Evaluate + Persist gated

### Step 2 — Evaluate Only

Run Evaluate Only on a safe test import.

Expected:
- no writes
- no AI call
- no template mutation

### Step 3 — Monitoring

Open:

`/admin/pdf-import-monitoring`

Expected:
- page loads
- alerts visible
- run monitoring check if safe
- acknowledge/resolve test alert if appropriate

### Step 4 — Retention

Open:

`/admin/pdf-import-retention`

Expected:
- page loads
- retention scan dry-run only
- no delete/archive operation exists

### Step 5 — Client Reports

Open:

`/admin/pdf-import-client-reports`

Expected:
- page loads
- generate safe preview
- no raw artifacts
- no signed URLs
- no logs
- save draft / approve / mark exported only if safe test report

### Step 6 — Release Gate

Run:

```
npm run pdf-import:release-gate
```

Expected:
- pass or pass_with_warnings

### Step 7 — Final SQL

Run:

`scripts/regression/pdf-import-phase-11-final-rollout-check.sql`

Expected:
- production_rollout_database_locked or production_rollout_locked_with_conditions
- no critical blockers

## Fail Criteria

- AI called automatically.
- Template mutated automatically.
- Cleanup deletes files.
- Client report leaks unsafe content.
- Unknown user can write.
- Release gate fails.
- Final SQL reports not locked.
- Private artifacts staged.
