# PDF Import Phase 8 Final Smoke Test

## Purpose

Validate the full Phase 8 golden corpus regression framework.

## Pre-conditions

- Latest `main` branch pulled.
- `npm run build` passes.
- Phase 8A–8F files exist.
- User has Template Builder access.
- Test PDF is safe and not committed.
- Supabase SQL Editor access is available.

## Browser Flow

1. Open Template Builder.
2. Import a safe golden PDF manually.
3. Use Hybrid mode unless the registry says otherwise.
4. Wait for import completion.
5. Open Review Quality.
6. Run Visual QA.
7. Run Repair.
8. Run AI reconciliation if recommended.
9. Rerun Visual QA if the draft changed.
10. Apply the repaired/reconciled template.
11. Confirm the editor opens.
12. Record or run export parity.
13. Save the golden regression summary if the operator flow supports it.
14. Open Template Import Quality.
15. Confirm golden regression status appears if a summary exists.
16. Confirm warnings/failures/action state appear.
17. Use the failure triage output if any warning/failure exists.
18. Run the final SQL.

## Non-Browser Validation

- Run the Phase 8 tests.
- Run the build.
- Run the final SQL.
- Confirm docs and modules exist.

## Required Evidence

- corpusId
- importId
- templateId
- Visual QA score
- repair status
- repair final score
- AI reconciliation status
- export parity status
- qualityGateStatus
- operatorDecision
- triage outcome
- final lock decision

## Failure Handling

- If the build fails → Phase 8 **not locked**.
- If tests fail → Phase 8 **not locked**.
- If the final SQL fails → Phase 8 **not locked**.
- If no real golden regression summary exists → Phase 8 may be **locked_with_warnings** if the
  framework exists and tests pass; Phase 9 should prioritize operational golden run execution.
- If the dashboard crashes → Phase 8 **not locked**.
- If the dashboard shows "Not run" for rows without golden summaries → acceptable.
- If export parity is manual-only → **locked_with_warnings** is acceptable.

## Final SQL

Run in Supabase SQL Editor:

```
scripts/regression/pdf-import-phase-8-final-check.sql
```

Expected: it runs read-only (no mutation), shows recent imports, golden summary status/coverage,
dashboard readiness, and failure triage source signals, and returns a
`phase_8_database_lock_status` verdict:

- `phase_8_ready_to_lock` — golden summaries exist, all passing.
- `phase_8_locked_with_warnings` — golden summaries exist with warnings.
- `phase_8_locked_with_warnings_no_golden_runs_persisted` — framework ready, no live run saved yet.
- `phase_8_not_locked_database_failures_present` — a golden run failed/blocked or an operator
  rejected/flagged-for-rerun run exists; investigate before locking.
