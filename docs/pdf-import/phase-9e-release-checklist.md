# PDF Import Release Checklist

## Purpose

This checklist is used before shipping PDF import / golden regression changes.

## Required Local Commands

Run the automated release gate (files + JSON + tests + build + private-artifact
check, then prints the SQL/browser checklists):

```
bash scripts/regression/pdf-import-phase-9-release-check.sh
```

The script runs these test files (equivalent to):

```
npm run test -- \
  src/lib/reportTemplate/__tests__/goldenCorpusRegistry.spec.ts \
  src/lib/reportTemplate/__tests__/goldenCorpusRunEvaluator.spec.ts \
  src/lib/reportTemplate/__tests__/pdfImportQualityGateEvaluator.spec.ts \
  src/lib/reportTemplate/__tests__/goldenRegressionSummary.spec.ts \
  src/lib/reportTemplate/__tests__/goldenRegressionPersistence.spec.ts \
  src/lib/reportTemplate/__tests__/pdfImportFailureTriageEvaluator.spec.ts \
  src/lib/reportTemplate/__tests__/goldenCorpusImportSnapshot.spec.ts \
  src/lib/reportTemplate/__tests__/goldenCorpusOrchestrator.spec.ts \
  src/lib/reportTemplate/__tests__/goldenCorpusConsoleState.spec.ts \
  src/lib/reportTemplate/__tests__/goldenRunHistorySummary.spec.ts \
  src/lib/reportTemplate/__tests__/goldenRunHistoryPersistence.spec.ts \
  src/lib/reportTemplate/__tests__/goldenRunBaselineComparison.spec.ts \
  src/lib/reportTemplate/__tests__/exportParityScore.spec.ts \
  src/lib/reportTemplate/__tests__/exportParityEvidence.spec.ts \
  src/lib/reportTemplate/__tests__/exportParityRunner.spec.ts \
  src/lib/reportTemplate/__tests__/pdfImportReleaseGateEvaluator.spec.ts
```

Optional (run if present):

```
npm run test -- \
  src/lib/reportTemplate/__tests__/goldenRegressionDisplay.spec.ts \
  src/lib/reportTemplate/__tests__/pdfImportFailureTriageRules.spec.ts
```

Build:

```
npm run build
```

## Required SQL Checks

Run in the Supabase SQL Editor (read-only):

- `scripts/regression/pdf-import-phase-8-final-check.sql`
- `scripts/regression/pdf-import-phase-9a-orchestrator-check.sql`
- `scripts/regression/pdf-import-phase-9b-console-check.sql`
- `scripts/regression/pdf-import-phase-9c-history-check.sql`
- `scripts/regression/pdf-import-phase-9d-export-parity-runner-check.sql`
- `scripts/regression/pdf-import-phase-9e-release-gate-check.sql`

## Required Browser Checks

Run the production preview:

```
npm run preview -- --host 0.0.0.0 --port 8080
```

Check:

- `/admin/pdf-golden-regression`
- `/admin/template-import-quality`
- `/admin/pdf-import-diagnostics` (if available)
- no console errors

## Private Artifact Check

Before commit:

```
git status --short
git diff --cached --name-only
```

Do not stage: `audit-output/`, PDFs, screenshots, generated PDFs, `.env`, logs,
`dist/`, `node_modules/`, Supabase config backups (`supabase/config.toml.before-*`).

## Release Decision

- `release_ready`
- `release_ready_with_warnings`
- `release_blocked`

## Sign-off

Record:

- date
- branch
- commit hash
- tests run
- build result
- SQL result
- browser result
- known warnings
- release decision
