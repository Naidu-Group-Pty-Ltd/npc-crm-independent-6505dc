# PDF Import Phase 9 Completion Checklist

## Objective

Phase 9 turns the Phase 8 golden corpus regression framework into an operational
rollout system. Phase 9 is complete when operators and developers can:

- run golden regression from a console
- persist latest summaries
- persist run history
- compare against baselines
- run export parity automation where evidence allows
- run release gates
- run monitoring readiness checks
- make a production rollout decision

## Phase 9 Scope

- Phase 9A — Golden Corpus Run Orchestrator
- Phase 9B — Operator Golden Regression Console
- Phase 9C — Regression History + Baseline Comparison
- Phase 9D — Automated Export Parity Runner
- Phase 9E — CI / Release Quality Gate Preparation
- Phase 9F — Monitoring + Alert Readiness
- Phase 9G — Production Rollout Lock

## What Phase 9 Adds

- One orchestration entry point for golden regression.
- Operator-facing admin console.
- Dedicated golden run history table (`public.pdf_import_golden_runs`).
- Baseline comparison.
- Export parity automation runner.
- Release gate evaluator + local release check script.
- Monitoring rules/evaluator + monitoring SQL.
- Final rollout SQL.

## System Flow Locked

Existing PDF import → Visual QA → Repair → optional export parity automation →
golden corpus orchestrator → golden run evaluation → quality gate evaluation →
regression summary build → failure triage → latest summary persistence → history
row persistence → baseline comparison → diagnostics/dashboard display → release
gate evaluation → monitoring evaluation → production rollout decision.

## Required Phase 9 Docs

- [x] docs/pdf-import/phase-9a-golden-corpus-orchestrator.md
- [x] docs/pdf-import/phase-9b-operator-run-console.md
- [x] docs/pdf-import/phase-9c-regression-history-baselines.md
- [x] docs/pdf-import/phase-9d-automated-export-parity.md
- [x] docs/pdf-import/phase-9e-ci-release-gates.md
- [x] docs/pdf-import/phase-9e-release-checklist.md
- [x] docs/pdf-import/phase-9f-monitoring-alert-readiness.md
- [x] docs/pdf-import/phase-9f-monitoring-runbook.md
- [x] docs/pdf-import/phase-9-completion-checklist.md
- [x] docs/pdf-import/phase-9-final-smoke-test.md
- [x] docs/pdf-import/phase-9-production-rollout-notes.md

## Required Phase 9 SQL

- [x] scripts/regression/pdf-import-phase-9a-orchestrator-check.sql
- [x] scripts/regression/pdf-import-phase-9b-console-check.sql
- [x] scripts/regression/pdf-import-phase-9c-history-check.sql
- [x] scripts/regression/pdf-import-phase-9d-export-parity-runner-check.sql
- [x] scripts/regression/pdf-import-phase-9e-release-gate-check.sql
- [x] scripts/regression/pdf-import-phase-9f-monitoring-check.sql
- [x] scripts/regression/pdf-import-phase-9-final-check.sql

## Required Phase 9 Scripts

- [x] scripts/regression/pdf-import-phase-9-release-check.sh
- [x] scripts/regression/pdf-import-phase-9-final-local-check.sh

## Required Phase 9 Modules

### Orchestrator
- [x] goldenCorpusOrchestratorTypes.ts
- [x] goldenCorpusImportSnapshot.ts
- [x] goldenCorpusOrchestrator.ts

### Console
- [x] PdfGoldenRegression.tsx
- [x] GoldenRegressionRunConsole.tsx
- [x] GoldenRegressionResultPanel.tsx
- [x] GoldenRegressionSnapshotPanel.tsx
- [x] GoldenRegressionQualityGatePanel.tsx
- [x] GoldenRegressionTriagePanel.tsx
- [x] goldenCorpusConsoleState.ts

### History
- [x] goldenRunHistoryTypes.ts
- [x] goldenRunHistorySummary.ts
- [x] goldenRunHistoryPersistence.ts
- [x] goldenRunBaselineComparison.ts
- [x] public.pdf_import_golden_runs migration

### Export Parity
- [x] exportParityRunnerTypes.ts
- [x] exportParityScore.ts
- [x] exportParityEvidence.ts
- [x] exportParityRunner.ts

### Release Gates
- [x] pdfImportReleaseGateTypes.ts
- [x] pdfImportReleaseGateEvaluator.ts

### Monitoring
- [x] pdfImportMonitoringTypes.ts
- [x] pdfImportMonitoringRules.ts
- [x] pdfImportMonitoringEvaluator.ts

## Required Tests

- [x] goldenCorpusImportSnapshot.spec.ts
- [x] goldenCorpusOrchestrator.spec.ts
- [x] goldenCorpusConsoleState.spec.ts
- [x] goldenRunHistorySummary.spec.ts
- [x] goldenRunHistoryPersistence.spec.ts
- [x] goldenRunBaselineComparison.spec.ts
- [x] exportParityScore.spec.ts
- [x] exportParityEvidence.spec.ts
- [x] exportParityRunner.spec.ts
- [x] pdfImportReleaseGateEvaluator.spec.ts
- [x] pdfImportMonitoringRules.spec.ts
- [x] pdfImportMonitoringEvaluator.spec.ts

## Required Existing Foundation Tests

- [x] goldenCorpusRegistry.spec.ts
- [x] goldenCorpusRunEvaluator.spec.ts
- [x] pdfImportQualityGateEvaluator.spec.ts
- [x] goldenRegressionSummary.spec.ts
- [x] goldenRegressionPersistence.spec.ts
- [x] pdfImportFailureTriageEvaluator.spec.ts

## Required Database Objects

- [x] public.template_imports exists.
- [x] public.report_templates exists.
- [x] public.pdf_import_jobs exists.
- [x] public.pdf_import_golden_runs exists.
- [x] template-import-artifacts storage bucket exists.
- [x] pdf_import_golden_runs has indexes.
- [x] pdf_import_golden_runs has RLS/policies according to project pattern.

## Required Backend Operations

In `template-import-pdf`:

- [x] append_meta
- [x] get_status (snapshot source)
- [x] save_export_parity
- [x] get_export_parity
- [x] save_golden_run_history
- [x] list_golden_run_history
- [x] get_golden_run_history
- [x] get_latest_golden_run_baselines

## Required Browser Behavior

- [ ] /admin/pdf-golden-regression loads.
- [ ] Corpus selector loads.
- [ ] Import ID can be entered.
- [ ] Evaluate Only works.
- [ ] Evaluate + Persist works when safe.
- [ ] Export parity automation option appears.
- [ ] Result panel displays status.
- [ ] Quality gate panel displays gates.
- [ ] Triage panel displays recommendations.
- [ ] History save result displays.
- [ ] Baseline comparison displays.
- [ ] Template Import Quality still loads.
- [ ] Template Import Quality deep-link to Golden Console works.
- [ ] No console errors.

> Browser behavior is validated manually (see the final smoke test). It is not
> automatable in this environment and is therefore left unchecked here.

## Required Release Gate Behavior

- [x] Release gate evaluator can return release_ready.
- [x] Release gate evaluator can return release_ready_with_warnings.
- [x] Release gate evaluator can return release_blocked.
- [x] Local release check script runs.
- [x] Phase 9E SQL runs.

## Required Monitoring Behavior

- [x] Monitoring evaluator can return healthy.
- [x] Monitoring evaluator can return warnings_present.
- [x] Monitoring evaluator can return errors_present.
- [x] Monitoring evaluator can return critical_alerts_present.
- [x] Monitoring evaluator can return release_blocked.
- [x] Phase 9F SQL runs.

## Production Rollout Decisions

### production_ready

Use when: all required files exist; tests pass; build passes; release script
passes; final SQL returns `production_ready_database` or an acceptable warning
state; monitoring is healthy or warnings-only; browser smoke passes; no private
artifacts staged; no critical blockers remain.

### production_ready_with_warnings

Use when: tests/build pass; local release script passes; SQL runs; browser smoke
(or page-load smoke) passes; no critical blockers remain; but one or more
acceptable warnings exist:

- no full six-corpus live coverage yet
- export parity Level 3 unavailable but Level 1/2 works
- OCR corpus requires manual review
- design-heavy corpus has expected warning-level drift
- baseline `no_baseline` for first run
- monitoring `warnings_present` with no critical/error alerts
- `release_ready_with_warnings` from Phase 9E

### production_blocked

Use when: build fails; required tests fail; local release script fails; private
artifacts staged; final SQL fails; release SQL returns `release_blocked_database`;
monitoring SQL returns `critical_alerts_present` or `release_blocked`; operator
console crashes; golden/history persistence fails; export parity runner crashes;
Supabase migration missing; backend operations missing; unknown-operation errors
remain.

## Phase 10 Readiness

Phase 10 can begin when Phase 9 is `production_ready` or
`production_ready_with_warnings`. Recommended Phase 10 direction: scheduled
monitoring delivery; Slack/email alert integration; automated golden corpus
execution; CI enforcement; production hardening; operator workflow polish.
