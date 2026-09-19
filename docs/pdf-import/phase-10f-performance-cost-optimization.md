# PDF Import Phase 10F — Performance + Cost Optimization

## Objective

Phase 10F creates a performance and cost optimization layer for the PDF import
intelligence stack.

The layer identifies repeated work, expensive operations, stale metadata,
long-running jobs, and safe reuse opportunities.

## Why This Exists

The PDF import system now has many advanced layers.

Without optimization, operators may repeatedly run expensive steps:

- Visual QA
- repair
- AI reconciliation
- export parity
- golden regression
- history persistence
- self-healing plans

Phase 10F helps the system decide when results can be reused, when metadata is
stale, and when expensive steps require confirmation.

## What Phase 10F Does

- Defines performance/cost audit types.
- Extracts performance signals from existing import metadata and audits.
- Defines a rough deterministic step cost model.
- Detects stale metadata using timestamps, versions, and dependency ordering.
- Detects duplicate/repeated work.
- Generates optimization recommendations.
- Persists `performance_cost_audit` metadata via existing `append_meta`.
- Displays the audit in the operator console.
- Adds unit tests.
- Adds read-only SQL validation.

## What Phase 10F Does Not Do

- Does not add global caching.
- Does not add Redis/external cache/queue/cron.
- Does not skip quality gates automatically.
- Does not bypass Visual QA.
- Does not bypass export parity.
- Does not call AI.
- Does not mutate templates.
- Does not create a database table.
- Does not create migrations.
- Does not modify the Cloud Run sidecar or Docling parser.
- Does not change pipeline behaviour by default.
- Does not store raw PDF/OCR text or screenshots/rasters.

## Optimization Domains

- `artifact_fetch` — duplicate artifact loads, large payloads, missing objects causing repeated retries.
- `visual_qa` — repeated browser rendering/capture, missing/stale QA, already-acceptable scores.
- `repair` — repeated repair audits, repair loops, repair not useful by profile/pattern.
- `ai_reconciliation` — AI recommended despite low value, AI blocked by policy, AI cost risk.
- `export_parity` — repeated parity runs, manual_required loops, rasterization unavailable.
- `golden_regression` — repeated evaluations without changed inputs, excessive history rows.
- `metadata` — large payloads, repeated full-summary writes, stale persisted metadata.
- `diagnostics` — long-running `pdf_import_jobs`, missing engine versions, failed job loops.
- `ui_dashboard` — large row payloads, unbounded lists, too many details rendered by default.
- `storage` — missing artifact objects, public bucket risk, repeated signed URL generation.

## Cost Levels

- `negligible` — pure local metadata calculation.
- `low` — small metadata load/save.
- `medium` — artifact fetch or dashboard row hydration.
- `high` — browser render / Visual QA / export parity.
- `very_high` — AI reconciliation, full reimport, large multi-page raster work.
- `unknown` — insufficient evidence.

## Recommendation Actions

- `no_action`
- `reuse_existing_result`
- `rebuild_stale_metadata`
- `defer_expensive_step`
- `require_operator_confirmation`
- `compact_metadata`
- `limit_query_scope`
- `cache_artifact_lookup`
- `rerun_only_if_inputs_changed`
- `avoid_ai_reconciliation`
- `require_manual_review_before_costly_step`
- `inspect_long_running_job`
- `inspect_storage_artifacts`
- `archive_or_prune_old_history`
- `document_manual_gap`

## Persistence Target

`template_imports.meta.performance_cost_audit`

Schema version: `pdf-import-performance-cost-audit-v1`. See
`performance-cost-audit.schema.json`. Stored fields: version, importId/templateId/
sourceFilename, overall cost/risk levels, estimated cost/waste scores, signals,
stepCosts, staleness, duplicateWork, recommendations, evidence, warnings,
blockers, generatedAt, persistedAt. No raw PDF content, OCR text, or rasters are
stored.

## Cost & Waste Scoring

- **Cost score** — average of per-step cost-level scores (negligible 0.05, low
  0.2, medium 0.45, high 0.7, very_high 0.95, unknown 0.5). Resolved back to an
  overall cost level.
- **Waste score** — increases with stale metadata, repeated history runs, export
  parity manual_required loops, long-running/failed jobs, reuse-despite-recompute
  opportunities, avoidable AI, and duplicate-work recommendations.
- **Risk level** — `critical` (waste > 0.85 or a critical blocker), `high` (waste
  > 0.65 or very-high-cost recommendations), `medium` (waste > 0.35), otherwise
  `low`; `unknown` when evidence is insufficient.

## Safety Rules

- Recommendations are advisory.
- No required quality step is skipped automatically.
- Expensive steps can be flagged but not suppressed.
- AI cost decisions respect the adaptive reconciliation policy.
- Manual review remains required for high-risk cases.
- No raw PDF content is stored.
- The audit never changes orchestration decisions.

## Orchestrator Integration

The golden corpus orchestrator gains optional `buildPerformanceCostAudit` and
`persistPerformanceCostAudit` request flags and `performanceCostAudit` /
`performanceCostAuditPersistenceResult` result fields. The audit is built near the
end of the chain (after import intelligence, repair patterns, adaptive policy,
self-healing, export parity, quality gates, golden summary, and triage) and is
non-gating: a build/persist problem only adds a warning.

## Operator Console

The Golden Regression Run Console gains **Build performance/cost audit** (default
on; read-only unless persisted) and **Persist performance/cost audit** toggles, a
confirm-dialog note, and a dedicated **Performance** result tab rendered by
`PerformanceCostAuditPanel` (overall cost/risk, cost/waste scores, step cost
breakdown, recommendations, staleness, duplicate work, warnings/blockers).

## Future Phase Usage

Phase 10G: operator controls can use the audit to show safe action buttons,
warnings, and cost-risk indicators.

Phase 10H: the final Phase 10 lock can validate performance risk coverage.

## Acceptance Criteria

- types exist
- signal extraction exists
- cost model exists
- staleness helper exists
- optimizer exists
- persistence helper exists
- display helper exists
- orchestrator integration exists
- console displays audit
- tests pass
- SQL exists
- build passes
- no private artifacts committed
