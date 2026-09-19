# PDF Import Phase 10G — Production Operator Controls

## Objective

Phase 10G creates a production-grade operator control layer for PDF import
intelligence and recovery workflows.

The controls allow operators to safely act on import intelligence, repair
patterns, adaptive reconciliation policy, self-healing plans, performance audits,
quality gates, and golden regression results.

## Why This Exists

The PDF import system now produces rich intelligence.

Operators need a safe control surface to decide what happens next.

Without explicit operator controls, intelligence remains advisory but
operationally disconnected.

## What Phase 10G Does

- Defines canonical operator controls.
- Extracts operator control signals from existing metadata.
- Determines control availability (available/recommended/blocked/manual/disabled).
- Executes safe metadata decision controls.
- Delegates orchestrator-safe controls to the console run flows.
- Blocks unsafe controls (AI, template mutation, reruns) as manual-only or blocked.
- Persists a production operator control audit.
- Displays controls in the Golden Regression console and result panel.
- Adds tests and read-only SQL validation.

## What Phase 10G Does Not Do

- Does not run uncontrolled automation or background jobs.
- Does not call AI automatically.
- Does not apply reconciliation plans automatically.
- Does not mutate templates automatically.
- Does not rerun PDF imports / browser-only Visual QA / repair automatically.
- Does not create a new table or migration.
- Does not modify the Cloud Run sidecar or Docling parser.
- Does not bypass quality gates or replace manual review.

## Control Safety Levels

- `read_only` — displays information or navigates to a page.
- `metadata_write` — writes only metadata to `template_imports.meta`.
- `orchestrator_safe` — runs the existing orchestrator in safe modes that do not
  mutate templates or call AI.
- `manual_workflow` — requires the operator to use an existing manual UI flow.
- `blocked` — action cannot proceed due to policy/safety.

## Control States

`available` · `recommended` · `requires_confirmation` · `manual_only` · `blocked`
· `disabled` · `completed` · `failed`.

## Operator Decision States

`not_reviewed` · `accepted` · `accepted_with_warnings` · `rejected` · `needs_rerun`
· `manual_review_required` · `blocked` (aligned with golden regression operator
decisions).

## Canonical Controls

Metadata decision controls (`metadata_write`): `mark_not_reviewed`,
`mark_accepted`, `mark_accepted_with_warnings`, `mark_rejected`, `mark_needs_rerun`,
`mark_manual_review_required`, `mark_blocked`, `add_operator_note`. These record
operator state/notes only; the decision controls require confirmation.

Orchestrator-safe controls (`orchestrator_safe`, require confirmation):
`build_import_intelligence_profile`, `build_repair_pattern_analysis`,
`build_adaptive_reconciliation_policy`, `build_self_healing_plan`,
`build_performance_cost_audit`, `run_export_parity_automation`,
`rerun_golden_regression`, `persist_golden_regression_summary`,
`save_golden_run_history`, `run_self_healing_execute_safe`. These are executed by
enabling the corresponding console option and re-running Evaluate — never by hidden
background execution.

Read-only controls (`read_only`): `open_template_editor`,
`open_template_import_quality`, `inspect_pdf_import_jobs`.

Manual workflow controls (`manual_workflow`, never executed by Phase 10G):
`rerun_visual_qa_manual`, `rerun_repair_manual`, `run_ai_reconciliation_manual`,
`apply_repair_manual`, `apply_reconciliation_manual`, `rerun_import_manual`,
`inspect_storage_artifacts`, `inspect_logs`. `run_ai_reconciliation_manual` and
`apply_reconciliation_manual` are blocked when the adaptive policy blocks AI;
`apply_repair_manual` is blocked when a repair pattern requires review first or the
deterministic repair strategy is blocked.

Blocked control: `clear_operator_control_audit` is always blocked in Phase 10G.

### When recommended / blocked (summary)

- `mark_accepted` — recommended on a passing quality gate with no manual-review
  requirement; blocked when the gate is fail/blocked or a repair pattern requires
  review first.
- `mark_accepted_with_warnings` — recommended on a warning gate.
- `mark_rejected` — recommended on a fail gate.
- `mark_needs_rerun` — recommended on fail/blocked gates or partial/failed/blocked
  self-healing.
- `mark_manual_review_required` — recommended when adaptive policy / Visual QA /
  repair / repair-pattern require manual review.
- `mark_blocked` — recommended when AI is blocked, repair strategy is blocked, or
  the gate is blocked.
- `build_*` controls — recommended when the corresponding metadata is missing.
- `run_export_parity_automation` — recommended when export parity is missing;
  requires confirmation under high performance risk/cost.
- `run_self_healing_execute_safe` — recommended when a planned self-healing audit
  exists and AI is not blocked.

## Execution Behaviour & Audit Output

Metadata decision controls produce a `metadataPatch` of the form
`{ production_operator_control_audit: updatedAudit }` and never mutate templates,
call AI, or run pipeline steps. Orchestrator-safe controls return `not_supported`
from the executor unless an `orchestratorRunner` is injected (the console maps them
to run-console options instead). Manual controls return `manual_required`; blocked
controls return `blocked`; controls needing confirmation return `blocked` with
`operator_confirmation_required` until confirmed.

## Persistence Target

`template_imports.meta.production_operator_control_audit` (schema version
`pdf-import-production-operator-control-audit-v1`). See
`production-operator-control-audit.schema.json`.

## Safety Rules

- Every write action must be explicit.
- Risky write actions require confirmation.
- AI actions are manual-only in Phase 10G.
- Template mutation and apply-repair/reconciliation actions are manual-only.
- Rerun import is manual-only.
- Blocked policy disables unsafe actions.
- Accepted/rejected decisions are metadata only.

## Future Phase Usage

Phase 10H: uses operator controls and the audit to lock Phase 10.

## Acceptance Criteria

- control types exist
- catalog exists
- signal extraction exists
- rules exist
- executor exists
- persistence exists
- display helper exists
- panel exists
- orchestrator integration exists
- tests pass
- SQL exists
- build passes
- no private artifacts committed
