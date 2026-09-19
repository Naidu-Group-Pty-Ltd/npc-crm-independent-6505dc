# PDF Import Phase 10D — Adaptive Reconciliation Rules

## Objective

Phase 10D creates a deterministic adaptive reconciliation policy for PDF imports.
The policy decides when AI reconciliation is not needed, optional, recommended,
manual-review-only, or blocked — as a governed decision layer, never as an
automatic AI call.

## Why This Exists

Earlier phases added AI reconciliation as an optional operator-triggered step.
Phase 10B added import intelligence and Phase 10C added repair pattern analysis.
The system can now make a governed decision about when AI reconciliation is
helpful and when it is unsafe.

## What Phase 10D Does

- Defines adaptive reconciliation policy types.
- Extracts reconciliation decision signals from existing metadata.
- Evaluates deterministic policy rules.
- Produces a policy decision with evidence, flags, and a source summary.
- Persists the policy to `template_imports.meta.adaptive_reconciliation_policy`.
- Displays the policy in the operator console.
- Integrates the policy into the golden corpus orchestrator.
- Adds tests and SQL validation.

## What Phase 10D Does Not Do

- Does not call AI automatically or apply reconciliation plans.
- Does not mutate templates or replace manual review.
- Does not create a table or migration, and does not modify the sidecar.
- Does not store raw PDF/OCR text.
- Does not change quality gates or repair pattern matching.
- Does not implement self-healing retries (Phase 10E).

## Policy Decisions

- **not_needed** — AI is unlikely to improve the result (low risk, good QA/repair/
  export, no major repair patterns).
- **optional** — AI may help but is not required (medium complexity, moderate
  scores, warnings without blockers).
- **recommended** — AI is likely useful and should be run by the operator (repair
  pattern AI usefulness high, meaningful drift, prerequisites present).
- **manual_review** — AI may help only with human review (scanned/OCR, missing
  content, manual-review flags, high risk, degraded baseline, failed gate).
- **blocked** — AI reconciliation should not run until blockers are resolved
  (repair pattern block, high automation/OCR risk, blocked quality gate, missing
  prerequisites, missing importId).

Precedence: **blocked > manual_review > recommended > optional > not_needed**.

## Policy Inputs

Import Intelligence Profile · Repair Pattern Analysis · Visual QA · Repair summary
· Export parity summary · Golden regression summary · Quality gate report ·
Failure triage summary · Existing AI reconciliation summary.

## Policy Output

Persisted to `template_imports.meta.adaptive_reconciliation_policy`:

version · importId · templateId · sourceFilename · decision · severity ·
confidence · recommendedAction · reasons · evidence · flags · sourceSummary ·
warnings · blockers · generatedAt.

**Flags:** requiresOperatorConfirmation · requiresManualReview ·
requiresVisualQaAfterReconciliation · requiresExportParityAfterReconciliation ·
shouldRerunRepairBeforeReconciliation · aiAllowed · aiBlocked ·
canProceedWithoutAi.

**Recommended actions:** no_action · allow_operator_choice · run_ai_reconciliation
· run_ai_reconciliation_with_review · require_manual_review ·
block_ai_reconciliation · rerun_visual_qa_first · rerun_repair_first ·
rerun_export_parity_first · inspect_template_editor · inspect_repair_patterns ·
inspect_import_profile.

## Severity & Confidence

Severity: blocked→critical, manual_review→high, recommended→medium (escalates to
high with high automation/import risk), optional→low (escalates to medium with
high manual-review likelihood), not_needed→info.

Confidence is coverage-based (import profile, repair pattern, Visual QA, repair,
export parity, golden/quality-gate, triage), minimum 0.2 when an importId exists,
up to ~0.98 when the full context is present.

## Safety Principles

- No automatic AI calls; the policy only governs the decision.
- Block AI when input is unsafe; prefer manual review for OCR/high-risk/
  missing-content cases.
- Require Visual QA and export parity rerun after reconciliation for recommended/
  manual_review decisions.
- Explain every decision with reasons + evidence.
- Never store private extracted content.

## Future Phase Usage

- **Phase 10E** — Self-healing can use this policy to decide whether running AI
  reconciliation is safe, or to require manual review.
- **Phase 10F** — Performance/cost optimisation can avoid unnecessary AI calls.
- **Phase 10G** — Operator controls can show the policy and allow a governed
  override.

## Acceptance Criteria

- policy types, signal extraction, evaluator, persistence, and display helpers
  exist
- reconciliation barrel exports the adaptive modules
- orchestrator can optionally build/persist the policy
- console displays the policy
- tests pass, SQL exists, build passes
- no private artifacts committed
