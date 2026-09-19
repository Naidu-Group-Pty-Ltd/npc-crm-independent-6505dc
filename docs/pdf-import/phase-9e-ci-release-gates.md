# PDF Import Phase 9E — CI / Release Quality Gate Preparation

## Objective

Phase 9E prepares the PDF import golden regression framework for release gating.
It defines what must pass before a PDF import release can be considered safe.

## Why This Exists

Phase 9A–9D created operational regression tooling (orchestrator, operator console,
history + baselines, export parity automation). Before the system can be used as a
production release signal, the team needs repeatable gates that can be run before
deployment. Phase 9E creates that release gate layer.

## Gate Classes

### Automated Local Gates

Run locally or in CI without credentials (categories `files`, `json`, `tests`,
`build`, `security`, `documentation`):

- required files exist
- JSON registry/template files are valid
- Phase 8/9 tests pass
- npm build passes
- private artifacts are not staged
- SQL files exist
- no Supabase config backup files are staged

### SQL / Database Gates

Run manually in the Supabase SQL Editor (categories `sql`, `database`):

- golden summaries exist
- golden history exists
- export parity metadata exists
- failure triage signals are visible
- release gate database status is acceptable

### Browser / Operator Gates

Run manually in the app (categories `browser`, `manual`):

- PDF Golden Regression console loads
- Evaluate Only works
- Evaluate + Persist works
- Template Import Quality shows golden state
- Export parity automation result is visible
- no console errors

## Release Gate Outcomes

### release_ready

All required automated gates pass. SQL/browser gates pass or are documented as not
required for the current release.

### release_ready_with_warnings

Automated gates pass, but one or more acceptable warnings exist. Acceptable
warnings include:

- no live golden corpus run persisted yet
- export parity Level 3 unavailable but Level 1/2 works
- OCR corpus requires manual review
- design-heavy corpus has warning-level drift
- SQL/browser validation not run yet but documented as pending (`allowManualPending`)

### release_blocked

A blocking failure exists. Blocking failures include:

- npm build fails
- required tests fail
- required modules missing
- private PDFs staged
- migration missing after Phase 9C
- release SQL missing
- app dashboard route broken
- Supabase config backup staged
- golden corpus registry invalid
- export parity runner tests fail
- orchestrator tests fail

## How the Evaluator Decides

`buildPdfImportReleaseGateReport({ gates, allowManualPending })` classifies each
gate:

- `fail` + required → blocker; `fail` + optional → warning
- `warning` → warning
- `not_run` + required → blocker, **unless** `allowManualPending` and the gate is a
  manual category (`sql` / `database` / `browser` / `manual`), in which case it is a
  warning
- `not_run` + optional, `pass`, `not_applicable` → info

Automated categories (`files`, `json`, `tests`, `build`, `security`,
`documentation`) always block on a required fail / not_run — they are locally
runnable and are never downgraded by `allowManualPending`.

Decision: any blocker → `release_blocked`; else any warning →
`release_ready_with_warnings`; else `release_ready`.

## Automated Gate List

- `required_phase_docs_present`
- `required_phase_sql_present`
- `golden_registry_json_valid`
- `golden_corpus_registry_tests`
- `golden_corpus_runner_tests`
- `quality_gate_tests`
- `golden_regression_tests`
- `failure_triage_tests`
- `orchestrator_tests`
- `operator_console_tests`
- `history_tests`
- `export_parity_runner_tests`
- `release_gate_tests`
- `npm_build`
- `private_artifact_check`

## Manual SQL Gate List

- `scripts/regression/pdf-import-phase-8-final-check.sql`
- `scripts/regression/pdf-import-phase-9a-orchestrator-check.sql`
- `scripts/regression/pdf-import-phase-9b-console-check.sql`
- `scripts/regression/pdf-import-phase-9c-history-check.sql`
- `scripts/regression/pdf-import-phase-9d-export-parity-runner-check.sql`
- `scripts/regression/pdf-import-phase-9e-release-gate-check.sql`

## Manual Browser Gate List

- `/admin/pdf-golden-regression` loads
- `/admin/template-import-quality` loads
- console can run evaluate-only
- console can run evaluate-and-persist if safe
- export parity automation can be triggered if safe
- no console errors

## Local Command

```
bash scripts/regression/pdf-import-phase-9-release-check.sh
```

Runs the Class 1 automated gates and prints the Class 2 (SQL) and Class 3 (browser)
checklists. It never runs Supabase SQL, never deploys, never requires credentials
or `lsof`, and never starts the preview server.

## Relationship to Future CI

Phase 9E does not fully enforce GitHub CI. It prepares a release gate script and
rules so CI can later run the same checks. The optional
`.github/workflows/pdf-import-regression.yml` runs the local script on PDF-import PRs
(using `npm install`, matching the repo's existing `ci.yml`, no secrets). Phase 9F
monitoring can reuse these gate definitions.

## Acceptance Criteria

- docs + release checklist exist
- release gate types + evaluator exist
- evaluator tests pass
- release script exists and runs
- SQL release check exists
- build passes
- no private artifacts committed
