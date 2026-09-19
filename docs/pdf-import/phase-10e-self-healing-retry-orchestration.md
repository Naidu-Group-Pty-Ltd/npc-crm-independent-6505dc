# PDF Import Phase 10E — Self-Healing Retry Orchestration

## Objective

Phase 10E adds a controlled, plan-first, explicitly-gated self-healing retry
layer for PDF imports. Given an import's existing failure and warning signals, it
builds an evidence-based recovery plan of discrete actions, assigns each action a
safety gate, may execute **only** safe metadata-level actions after an explicit
operator trigger, and persists a structured audit trail. It is a governor and a
recorder — never an autonomous actor.

## Why This Exists

Phases 8–10D produced rich, structured post-import signals: Visual QA, repair
audits, export parity, the import intelligence profile (10B), the repair pattern
analysis (10C), and the adaptive reconciliation policy (10D). Operators can now
diagnose why an import struggled, but turning that diagnosis into a repeatable,
safe recovery sequence was still manual and ad-hoc. Phase 10E encodes that
sequence as a deterministic, auditable plan with hard safety rails.

## What Phase 10E Does

- Defines self-healing retry types, signals, rules, planner, executor,
  persistence, and display helpers.
- Extracts recovery signals from existing Phase 8/9/10 metadata (no new sources).
- Derives a prioritized, de-duplicated recovery plan of discrete actions.
- Assigns each action an explicit safety level and resolves its planned status.
- Optionally executes **only** safe/supported metadata-level actions, and only
  after an explicit operator trigger.
- Persists the audit to `template_imports.meta.self_healing_retry_audit` via the
  existing `append_meta` operation.
- Surfaces the plan and outcome in the operator console (dedicated panel + tab).
- Integrates the plan/execute/persist phases into the golden corpus orchestrator.
- Adds unit tests, a JSON Schema, and a read-only SQL validation script.

## What Phase 10E Does NOT Do

- Does **not** call AI automatically. `run_ai_reconciliation` is always manual.
- Does **not** mutate templates or apply repairs.
- Does **not** rerun the PDF import, Visual QA, repair, or browser-dependent
  export parity automatically — those actions are surfaced as manual only.
- Does **not** create a table, migration, or Supabase function, and does not
  modify the sidecar/Docling.
- Does **not** store raw PDF text, OCR text, screenshots, or rasters in metadata.
- Does **not** change quality gates, repair patterns, or the adaptive policy.

## Execution Modes

- **dry_run** (default) — builds the plan only; nothing is executed. `executedAt`
  stays null.
- **audit_only** — builds and records the plan; still executes nothing.
- **execute_safe** — executes actions gated `safe_automatic` only.
- **execute_confirmed** — additionally executes `operator_confirmed` actions, and
  only when the operator confirmation flag is set. Without confirmation the run
  holds those actions for manual action and emits
  `self_healing_operator_confirmation_required`.

## Safety Levels

Each planned action carries one of:

- **safe_automatic** — a pure metadata/read action that is safe to run
  automatically in an execute mode (e.g. `reload_snapshot`).
- **operator_confirmed** — a metadata action that may run only after explicit
  operator confirmation in `execute_confirmed`.
- **manual_only** — surfaced for a human to perform out-of-band; never executed by
  this layer (AI reconciliation, import/Visual QA/repair reruns, editor/storage
  inspection).
- **blocked** — must not run until a prerequisite/blocker is resolved.

The executor treats AI, import reruns, Visual QA reruns, repair reruns, and manual
export-parity reruns as never-automatic: even under `execute_confirmed` they
resolve to `manual_required`, never `completed`. Build/persist actions the
orchestrator already performs in-line resolve to `not_supported` (there is nothing
new for the standalone executor to do). Only `reload_snapshot` executes as a true
standalone safe action.

## Action Statuses

`pending` · `skipped` · `completed` · `failed` · `blocked` · `manual_required` ·
`not_supported`. Retry limits are bounded (default max 2 attempts per action; at
most 10 planned actions and 5 executable actions per plan).

## Plan Statuses

`planned` · `completed` · `completed_with_warnings` · `partial` · `blocked` ·
`failed` · `no_action`. A missing importId blocks the plan; an empty plan is
`no_action`; a plan containing a blocking `block_until_manual_review` action is
`blocked`.

## Signals Consumed

Import status · Visual QA (score, manual-review flag) · repair audit (status,
final score, fallback/manual-review flags) · export parity (status, score) ·
import intelligence profile (category, risk) · repair pattern analysis (primary
pattern, severity, deterministic strategy, operator-review requirement) ·
adaptive reconciliation policy (decision, recommended action, AI-blocked, manual
review, rerun-repair-first) · golden quality gate + operator decision + failure/
warning counts · triage outcome/action/severity · baseline outcome · failure and
warning codes · previous-audit action counts.

## Persisted Output

`template_imports.meta.self_healing_retry_audit` — see
`self-healing-retry-audit.schema.json`. Version:
`pdf-import-self-healing-retry-audit-v1`. Contains the plan id, mode, plan status,
the full action list (with safety level, status, priority, reason codes,
prerequisites, evidence, attempt counts), a numeric summary, warnings, blockers,
and generated/executed/persisted timestamps.

## Safety Principles

- Plan-first and evidence-based: every action records why it was planned.
- Explicit gating: nothing outside `safe_automatic`/`operator_confirmed` executes,
  and `operator_confirmed` requires an explicit trigger.
- Conservative executor: risky and browser-dependent actions are always manual.
- Additive and read-only by default: no schema changes, no new I/O paths, and the
  default mode executes nothing.

## Operator Console

The Golden Regression Run Console gains a **Build self-healing retry plan** toggle
(off by default), a **Persist self-healing audit** toggle, a **Self-healing
execution mode** selector, and an **Operator confirmation** switch (enabled only
for `execute_confirmed`). The confirm-persist dialog states the selected mode and
the safety guarantees. A dedicated **Self-Healing** result tab and the
`SelfHealingRetryPanel` render the plan, per-action safety/status, evidence, and
persistence outcome.

## Validation

- `scripts/regression/pdf-import-phase-10e-self-healing-check.sql` — read-only
  coverage, distribution, per-action expansion, a safety-invariant query
  (never-automatic actions must never be `completed`; expect 0 rows), integrity
  validation, and readiness sections.
- Unit tests cover signals, rules, planner, executor, persistence, display, the
  console form, and orchestrator integration (16 self-healing orchestrator tests).

## Acceptance Criteria

- Deterministic plan build from existing signals; no new data sources.
- Explicit safety gates; AI/template/import/browser actions never run
  automatically.
- Default `dry_run` executes nothing; execution requires an explicit mode and, for
  `execute_confirmed`, an explicit operator confirmation.
- Audit persisted only via `append_meta`; no raw PDF/OCR text or screenshots.
- Type-checks clean; unit tests pass; SQL is read-only and valid.
