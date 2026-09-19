# PDF Import Phase 9B — Operator Golden Regression Run Console

## Objective

Phase 9B creates an admin console for running the Phase 9A Golden Corpus Run Orchestrator from
the dashboard. The console lets an operator evaluate and optionally persist a golden regression
summary for an existing PDF import.

## Why This Exists

Phase 9A centralized the orchestration logic, but it still required a code-level invocation.
Phase 9B makes the workflow operational: an operator can select a corpus item, provide an
import ID, run evaluation, review gates and triage, persist the summary, and confirm the
dashboard state.

## What Phase 9B Does

- Adds a dedicated admin page (`/admin/pdf-golden-regression`) + route.
- Adds a reusable `GoldenRegressionRunConsole` component.
- Adds snapshot, result, quality gate, and triage panels.
- Adds evaluate-only and evaluate-and-persist modes with confirm-before-persist.
- Adds a deep-link "Golden" action from Template Import Quality.
- Adds console-state helpers + tests and read-only SQL validation.

## What Phase 9B Does Not Do

- Does not upload or import PDFs.
- Does not create a run-history table, migrations, or a Supabase function.
- Does not automate export parity, run CI gates, or modify the sidecar.
- Does not replace Template Import Quality.

## Page Location

`/admin/pdf-golden-regression` — admin-gated via the existing `ModuleGuard moduleKey="templates"`
pattern (same guard as Template Import Quality).

## Operator Workflow

1. Open PDF Golden Regression.
2. Select the corpus ID (defaults to `golden-simple-001`).
3. Paste the import ID (optionally template ID, run ID, run batch ID).
4. Choose an operator decision and add notes.
5. Click **Evaluate Only**.
6. Review the snapshot, orchestration steps, quality gates, summary, and triage.
7. Click **Evaluate + Persist** when ready and confirm.
8. Review the persisted status; open Template Import Quality to verify.

## Console Modes

- **Evaluate Only** — runs the orchestrator without saving (preview / review / debugging). Fully
  read-only.
- **Evaluate + Persist** — runs the orchestrator and saves
  `template_imports.meta.golden_regression_summary` via the Phase 9A orchestrator. Failing/blocked
  summaries may be persisted as evidence (the whole point is to record real regressions).

## Required Safety Controls

- Persist requires a valid corpus ID and import ID (validation blocks the button).
- Persist is gated behind an explicit confirmation dialog.
- The dialog states that failing/blocked summaries may still be persisted as evidence.
- The result shows whether it was persisted and surfaces persistence errors.
- Evaluate-only performs no writes; the UI only calls `orchestrateGoldenCorpusRun`.

## Console Sections

- **Input form** — corpus select, import ID, template ID, run ID, run batch ID, operator
  decision, notes, and the Evaluate Only / Evaluate + Persist / Reset / Copy Result JSON buttons.
- **Snapshot panel** — the loaded import metadata (from `result.runEvaluation.snapshot`).
- **Result panel** — status, identity, orchestration steps, golden regression summary,
  warnings/failures, and persistence result.
- **Quality gate panel** — the Phase 8C report (summary + per-gate table).
- **Triage panel** — the Phase 8F summary (severity, outcome, owner, action, recommendations).
- **JSON tab** — the full result object.

## Deep-Linking

`/admin/pdf-golden-regression?importId=<id>&templateId=<id>&corpusId=<id>` — `importId`,
`templateId`, and a valid `corpusId` prefill the form. Template Import Quality rows link with
`importId` (and `corpusId` when a golden summary already exists).

## Snapshot Source

The console never calls the snapshot loader directly. It only invokes
`orchestrateGoldenCorpusRun`, and reads the snapshot from `result.runEvaluation.snapshot`.

## Error Handling

Validation errors block the run buttons. Orchestrator failure states (missing/unknown corpus,
missing import ID, snapshot load failure/missing, quality-gate fail/blocked, persistence
failure) are surfaced in the result (status, steps, warnings/failures, persistence result) and
via toasts; thrown exceptions show a destructive alert. Failing/blocked results are valid
outputs and are not hidden.

## Acceptance Criteria

- page, route, console form, and result panels exist
- evaluate-only and evaluate-and-persist (with confirmation) work
- deep-link `importId` prefills
- Template Import Quality deep-link exists
- tests pass; build passes
- no private files committed; no Supabase deployment (backend reused)

## Recommended Next Phase

**Phase 9C — Golden Run History:** persist a history of orchestrated runs (beyond the single
latest `golden_regression_summary`) for trend/regression tracking, and surface it in the console.
