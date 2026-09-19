# PDF Import Phase 8 Completion Checklist

## Objective

Phase 8 turns the Phase 7 PDF import quality pipeline into a repeatable golden corpus
regression framework.

Phase 8 is complete when the system can define, run, evaluate, persist, display, and triage
golden corpus regression results.

## Phase 8 Scope

- Phase 8A — Golden Corpus Registry
- Phase 8B — Golden Corpus Runner
- Phase 8C — Quality Threshold Gates
- Phase 8D — Golden Regression Result Persistence
- Phase 8E — Diagnostics Dashboard Upgrade
- Phase 8F — Failure Triage + Recovery Playbooks
- Phase 8G — Final Phase 8 Regression Lock

## What Phase 8 Adds

- Canonical golden corpus IDs.
- Registry schema/template.
- TypeScript registry helpers.
- Golden run evaluator.
- Quality gate evaluator.
- Golden regression summary builder.
- Golden regression persistence helper.
- Diagnostics dashboard visibility.
- Failure triage rules and playbook.
- Final SQL validation.

## System Flow Locked

```
Manual golden PDF selection
→ Browser PDF import
→ Visual QA
→ Repair
→ AI reconciliation if recommended
→ Apply repaired/reconciled template
→ Export parity recording/running
→ Golden run evaluation
→ Quality gate evaluation
→ Golden regression summary persistence
→ Diagnostics dashboard display
→ Failure triage recommendation
→ Final SQL validation
```

## Canonical Golden Corpus IDs

- golden-simple-001
- golden-design-001
- golden-report-001
- golden-table-001
- golden-image-001
- golden-ocr-001

## Required Phase 8 Files

- [x] docs/pdf-import/phase-8a-golden-corpus-registry.md
- [x] docs/pdf-import/golden-corpus-registry.schema.json
- [x] docs/pdf-import/golden-corpus-registry.template.json
- [x] docs/pdf-import/golden-corpus-run.template.json
- [x] docs/pdf-import/phase-8b-golden-corpus-runner.md
- [x] docs/pdf-import/phase-8c-quality-gates.md
- [x] docs/pdf-import/phase-8d-regression-result-persistence.md
- [x] docs/pdf-import/phase-8e-diagnostics-dashboard.md
- [x] docs/pdf-import/phase-8f-failure-triage-playbook.md
- [x] scripts/regression/pdf-import-phase-8a-golden-corpus-registry-check.sql
- [x] scripts/regression/pdf-import-phase-8b-golden-run-check.sql
- [x] scripts/regression/pdf-import-phase-8c-quality-gates-check.sql
- [x] scripts/regression/pdf-import-phase-8d-regression-persistence-check.sql
- [x] scripts/regression/pdf-import-phase-8e-diagnostics-dashboard-check.sql
- [x] scripts/regression/pdf-import-phase-8f-failure-triage-check.sql
- [x] scripts/regression/pdf-import-phase-8-final-check.sql

## Required TypeScript Modules

- [x] src/lib/reportTemplate/ingestion/goldenCorpus/goldenCorpusTypes.ts
- [x] src/lib/reportTemplate/ingestion/goldenCorpus/goldenCorpusRegistry.ts
- [x] src/lib/reportTemplate/ingestion/goldenCorpus/goldenCorpusRunTypes.ts
- [x] src/lib/reportTemplate/ingestion/goldenCorpus/goldenCorpusRunEvaluator.ts
- [x] src/lib/reportTemplate/ingestion/goldenCorpus/goldenRegressionTypes.ts
- [x] src/lib/reportTemplate/ingestion/goldenCorpus/goldenRegressionSummary.ts
- [x] src/lib/reportTemplate/ingestion/goldenCorpus/goldenRegressionPersistence.ts
- [x] src/lib/reportTemplate/ingestion/qualityGates/pdfImportQualityGateTypes.ts
- [x] src/lib/reportTemplate/ingestion/qualityGates/pdfImportQualityGateEvaluator.ts
- [x] src/lib/reportTemplate/ingestion/failureTriage/pdfImportFailureTriageTypes.ts
- [x] src/lib/reportTemplate/ingestion/failureTriage/pdfImportFailureTriageRules.ts
- [x] src/lib/reportTemplate/ingestion/failureTriage/pdfImportFailureTriageEvaluator.ts

(Also present: `goldenRegressionDisplay.ts` for the Phase 8E dashboard.)

## Required Tests

- [x] goldenCorpusRegistry.spec.ts
- [x] goldenCorpusRunEvaluator.spec.ts
- [x] pdfImportQualityGateEvaluator.spec.ts
- [x] goldenRegressionSummary.spec.ts
- [x] goldenRegressionPersistence.spec.ts
- [x] goldenRegressionDisplay.spec.ts
- [x] pdfImportFailureTriageEvaluator.spec.ts
- [x] pdfImportFailureTriageRules.spec.ts

All Phase 8 + relevant Phase 7 specs pass (163 tests across 12 files at lock time).

## Required Dashboard Behavior

- [x] Template Import Quality still loads.
- [x] Visual QA score/status appears.
- [x] Repair status appears.
- [x] AI reconciliation status appears when present.
- [x] Export parity status appears when present.
- [x] Golden regression status appears when present.
- [x] Warning count appears when present.
- [x] Failure count appears when present.
- [x] Action required appears when present.
- [x] Rows without golden regression show Not run / Not evaluated safely.
- [x] Existing actions still work.

(Verified via successful build/compile; live browser render is the operator smoke-test step.)

## Required Persistence Behavior

- [x] golden_regression_summary can be built.
- [x] golden_regression_summary can be saved to template_imports.meta.
- [x] golden_regression_summary can be loaded.
- [x] persistedAt is populated when saved.
- [x] No dedicated database table is required in Phase 8.
- [x] append_meta is used safely (ownership-checked; verified in Phase 8D).

## Required SQL Validation

- [x] Phase 8 final SQL runs.
- [x] It returns latest imports with Phase 7/8 metadata.
- [x] It validates golden regression summaries.
- [x] It validates quality gate status distribution.
- [x] It validates diagnostics dashboard readiness.
- [x] It validates failure triage source conditions.
- [x] It returns a final database lock readiness status.

## Lock Decisions

### locked

- all required files exist
- tests pass
- build passes
- final SQL runs
- at least one golden regression summary exists (or its absence is documented as no golden run executed yet)
- dashboard displays golden state when metadata exists
- triage mappings exist
- no blocking defects remain

### locked_with_warnings

- core framework exists and tests/build pass
- no production-breaking issues exist
- but no real golden run has been persisted yet
- export parity is manual-only
- OCR/manual review remains expected
- some dashboard rows show warnings by design

### not_locked

- build fails
- tests fail
- required modules are missing
- final SQL fails
- golden regression summary cannot persist/load
- dashboard crashes
- triage evaluator cannot map failures
- critical backend contract issues remain

## Current Lock Decision

**locked_with_warnings.** The full Phase 8 framework (code, docs, SQL) exists; 163 tests pass;
the build passes; and the final SQL runs read-only against the live DB
(`phase_8_database_lock_status = phase_8_locked_with_warnings_no_golden_runs_persisted`). The
single warning is that **no live golden regression summary has been persisted yet** — no
operator has run a golden PDF through the full browser flow and saved a summary. There are zero
`fail`/`blocked`/operator-blocking database failures.

To flip to fully **locked**, an operator runs at least one golden PDF end-to-end
(`docs/pdf-import/phase-8-final-smoke-test.md`) and persists a passing
`golden_regression_summary`; the final SQL then returns `phase_8_ready_to_lock`.

## Acceptable Warnings

- No real golden run persisted yet.
- Export parity is manual-only.
- OCR corpus requires manual review.
- Design-heavy corpus has warning-level drift.
- AI reconciliation is optional/manual.
- Some rows are Not run / Not evaluated because no golden regression summary was saved.

## Blocking Failures

- build failure
- missing registry
- missing runner
- missing quality gate evaluator
- missing persistence helper
- missing diagnostics display
- missing triage evaluator
- append_meta broken
- template_imports.meta.golden_regression_summary cannot save
- final SQL fails
- private PDFs committed

## Phase 9 Readiness

Phase 9 can begin when Phase 8 is `locked` or `locked_with_warnings`.

Recommended Phase 9 direction:
- automated golden corpus execution
- CI/release quality gate enforcement
- scheduled regression monitoring
- production alerts
- operator workflow polish
