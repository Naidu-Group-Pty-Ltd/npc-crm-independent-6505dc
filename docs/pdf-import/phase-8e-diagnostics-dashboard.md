# PDF Import Phase 8E — Diagnostics Dashboard Upgrade

## Objective

Phase 8E surfaces golden regression and quality gate state inside the Template Import Quality
diagnostics dashboard.

## Why This Exists

Phase 8A–8D created the registry, runner, quality gates, and persisted golden regression
summaries.

Operators now need a clear dashboard view showing which PDF imports are healthy, which require
review, and which failed regression gates.

## Dashboard Scope

The diagnostics dashboard shows, per import:

- import status
- source filename
- page count
- Visual QA score
- Visual QA manual review flag
- repair status / repair passes
- export parity status + score
- golden corpus ID
- golden quality gate status
- golden operator decision (via action state)
- warning count
- failure count
- action required

## What Phase 8E Does

- Extends the diagnostics data returned by `list_visual_quality` with a normalized
  `golden_regression` object and a `golden` stats block.
- Adds a **Golden** column and an **Action** column to the Template Import Quality table.
- Adds a compact **Golden runs** stats card (`Pass X · Warn Y · Fail Z`).
- Adds golden gate flags (`Gate fail` / `Gate warn`) to the existing Flags column.
- Adds a pure display helper (`goldenRegressionDisplay.ts`) + tests.
- Adds read-only SQL validation.

## What Phase 8E Does Not Do

- Does not create new golden regression summaries.
- Does not run quality gates.
- Does not persist new data.
- Does not create a database table.
- Does not upload PDFs.
- Does not automate browser tests.
- Does not modify the sidecar.

## Data Source

Primary data source: `template_imports.meta`, surfaced through the secure
`template-import-pdf` `list_visual_quality` operation (read-only). Expected keys:

- `visual_quality_summary`
- `visual_repair_summary`
- `ai_reconciliation_summary`
- `export_parity_summary`
- `golden_regression_summary`

Artifact paths: `visual_quality_artifact_path`, `visual_repair_artifact_path`,
`export_parity_artifact_path`.

`list_visual_quality` now maps a normalized `golden_regression` object per row
(version, runId, runBatchId, corpusId, category, qualityGateStatus, operatorDecision,
runStatus, runDecision, warningCount, failureCount, first 5 warnings/failures,
generatedAt, persistedAt) and a `stats.golden` block
(total / pass / warning / fail / blocked / not_evaluated / needs_review).

## Dashboard Status Definitions

- **Pass** — golden `qualityGateStatus = pass`.
- **Warning** — golden `qualityGateStatus = warning`, or non-blocking warning metadata exists.
- **Fail** — golden `qualityGateStatus = fail`.
- **Blocked** — golden `qualityGateStatus = blocked`.
- **Not evaluated** — golden `qualityGateStatus = not_evaluated`.
- **Not run** — no golden regression summary exists.
- **Needs review** — manual review required, failures exist, export parity `manual_required`, or
  `operatorDecision` in `needs_rerun` / `not_reviewed`.

## Action Required Logic

The display helper resolves a display-level action state:

- **none** — `qualityGateStatus pass`, no failures, `operatorDecision accepted`.
- **review** — `qualityGateStatus warning`/`not_evaluated`, `operatorDecision accepted_with_warnings`,
  manual review required, export parity `manual_required`, or no golden run yet.
- **rerun** — `operatorDecision needs_rerun`, `qualityGateStatus blocked`.
- **fix** — `qualityGateStatus fail`, `failureCount > 0`, `operatorDecision rejected`.

Ordering is significant: hard-fail signals win over warnings, which win over pass.

## Columns / Badges

Table columns: When · File · Status · Pages · Overall · Final mode · Repairs · Export ·
**Golden** · **Action** · Providers · Flags · Actions.

- **Golden** — corpus ID + a gate badge (`Pass` / `Warning · 2W` / `Fail · 1F` / `Blocked` /
  `Not evaluated` / `Not run`); tooltip previews the first failures/warnings.
- **Action** — `None` / `Review` / `Rerun` / `Fix`.
- **Flags** — existing Manual/error flags plus `Gate fail` / `Gate warn` when golden data exists.

Tone → Badge variant: success→default, warning→secondary, destructive→destructive, outline→outline
(no custom warning/success Badge variants exist in the design system).

## Phase 8E Acceptance Criteria

- docs exist
- dashboard displays golden regression summary state
- dashboard displays warning/failure counts
- dashboard displays action required state
- backend list response includes golden regression summary
- SQL validation exists
- build passes
- no data mutation added

## Backend / Deployment

`supabase/functions/template-import-pdf/index.ts` `list_visual_quality` was extended (normalized
`golden_regression` row object + `stats.golden`). This is a read-only enrichment; no new
operation and no schema change. Because the edge function changed, it is redeployed
(byte-verified). No other Supabase change.
