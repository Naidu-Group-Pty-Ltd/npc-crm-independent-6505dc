# PDF Import Phase 10 Final Smoke Test

## Purpose

This smoke test verifies that the Phase 10 production intelligence system works
end-to-end without introducing unsafe automation.

## Preconditions

- Phase 7 locked.
- Phase 8 locked.
- Phase 9 complete.
- Phase 10A–10G complete.
- npm dependencies installed.
- Supabase environment available.
- At least one safe test import exists.
- Do not use sensitive client PDFs unless explicitly approved.

## Commands

1. Build:

    npm run build

2. Preview:

    npm run preview -- --host 0.0.0.0 --port 8080

3. Open:

    Cloud Shell → Web Preview → Preview on port 8080

## Smoke Test Flow

### Step 1 — Open Golden Regression Console

Open `/admin/pdf-golden-regression`.

Expected: page loads, no console error, corpus selector appears, import ID field
appears.

### Step 2 — Evaluate Only Full Intelligence Stack

Enable: build import intelligence profile, repair pattern analysis, adaptive
reconciliation policy, self-healing retry plan, performance/cost audit, production
operator controls. Keep all persistence disabled. Run Evaluate Only.

Expected: no writes occur; every Phase 10 panel appears (import intelligence,
repair pattern, adaptive reconciliation, self-healing, performance/cost, operator
controls, Phase 10 lock preview); no AI call; no template mutation; no repair or
reconciliation applied.

### Step 3 — Evaluate + Persist Metadata

Enable persistence for: import intelligence profile, repair pattern analysis,
adaptive reconciliation policy, self-healing retry audit, performance/cost audit,
production operator control audit. Run Evaluate + Persist.

Expected: confirmation dialog appears; metadata persists through append_meta; no AI
call; no template mutation; no repair/reconciliation applied; result panels show
persistence statuses.

### Step 4 — Operator Control Metadata Action

On a non-sensitive test import, execute a safe metadata operator control
(`mark_manual_review_required` or `mark_accepted_with_warnings`).

Expected: confirmation appears if required; operator audit updates;
`production_operator_control_audit` persists; no AI call; no template mutation.

### Step 5 — Blocked/Manual Controls

Confirm: `run_ai_reconciliation_manual` is manual-only or blocked when the adaptive
policy blocks it; `apply_repair_manual`, `apply_reconciliation_manual`, and
`rerun_import_manual` are manual workflow; `clear_operator_control_audit` is
blocked.

### Step 6 — Template Import Quality

Open `/admin/template-import-quality`. Expected: page loads; existing visual
quality/golden status still appears; Phase 10 compact display appears if
implemented; links to Golden Console work if implemented.

### Step 7 — PDF Import Diagnostics

Open `/admin/pdf-import-diagnostics`. Expected: page loads; jobs/diagnostics still
visible; no regression from Phase 10.

### Step 8 — Final SQL

Run `scripts/regression/pdf-import-phase-10-final-check.sql`. Expected: SQL runs
without mutation; lock status query returns `database_phase10_locked` or
`locked_with_warnings`; no critical blockers.

## Pass Criteria

Build passes; preview loads; Evaluate Only works; Evaluate + Persist works;
operator metadata action works; AI is not called automatically; templates are not
mutated automatically; SQL runs; no private artifacts are staged.

## Fail Criteria

Build fails; preview fails; SQL fails unexpectedly; AI is called automatically;
template is mutated automatically; operator controls bypass quality gates; a
manual-only action executes automatically; private artifacts are staged.
