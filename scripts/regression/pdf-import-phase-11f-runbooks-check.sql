-- Phase 11F Production Runbooks + SOPs Check
-- Run in the Supabase SQL Editor.
--
-- Purpose:
-- Database-side support check for PDF import runbook/SOP readiness. It maps live
-- operational signals (alerts, retention candidates, operator states, failed
-- jobs) to the runbooks that are actively needed.
--
-- This SQL is READ-ONLY. Markdown file existence + section completeness are
-- validated by the TypeScript runbook registry/evaluator and local tests.
--
-- NOTE: pdf_import_monitoring_events uses rule_id (not alert_rule_id). Rule IDs
-- are the Phase 11C canonical ids (import_failure_detected, sidecar_unavailable,
-- artifact_bucket_public_exposure, golden_quality_gate_failed, ...).

-- ---------------------------------------------------------------------------
-- 1. Active monitoring alerts mapped to runbook needs
-- ---------------------------------------------------------------------------
select
  e.rule_id,
  e.domain,
  e.severity,
  e.status,
  count(*) as alert_count,
  case
    when e.rule_id in ('import_failure_detected', 'import_stuck_in_progress', 'import_error_rate_high', 'import_duration_regression') then 'pdf-import-incident-response-sop.md'
    when e.rule_id in ('sidecar_unavailable', 'sidecar_diagnostics_failed', 'sidecar_engine_version_missing') then 'pdf-import-incident-response-sop.md'
    when e.rule_id in ('artifact_bucket_public_exposure', 'source_raster_missing', 'private_artifact_exposure_risk', 'raw_content_persistence_risk') then 'pdf-import-incident-response-sop.md'
    when e.rule_id in ('visual_qa_missing', 'visual_qa_low_similarity') then 'pdf-import-visual-qa-review-sop.md'
    when e.rule_id in ('repair_audit_missing', 'repair_failure_rate_high') then 'pdf-import-repair-pattern-review-sop.md'
    when e.rule_id in ('reconciliation_manual_backlog', 'reconciliation_plan_unresolved') then 'pdf-import-adaptive-reconciliation-sop.md'
    when e.rule_id in ('export_parity_missing', 'export_parity_failed', 'export_parity_manual_required') then 'pdf-import-export-parity-review-sop.md'
    when e.rule_id in ('golden_quality_gate_failed', 'golden_quality_gate_blocked', 'golden_baseline_degraded', 'golden_corpus_coverage_incomplete') then 'pdf-import-golden-regression-review-sop.md'
    when e.rule_id in ('operator_control_blocked_bypass') then 'pdf-import-self-healing-review-sop.md'
    when e.rule_id in ('unauthorized_write_attempt', 'permission_escalation_detected') then 'pdf-import-permission-denied-sop.md'
    when e.rule_id in ('release_gate_blocked', 'release_readiness_regressed') then 'pdf-import-release-gate-failure-sop.md'
    when e.rule_id in ('performance_budget_exceeded', 'quality_gate_regression', 'monitoring_check_stale') then 'pdf-import-weekly-qa-checklist.md'
    else 'pdf-import-monitoring-alert-response-sop.md'
  end as recommended_runbook
from public.pdf_import_monitoring_events e
where e.status in ('open', 'acknowledged')
group by e.rule_id, e.domain, e.severity, e.status
order by
  case e.severity when 'critical' then 1 when 'high' then 2 when 'warning' then 3 when 'info' then 4 else 5 end,
  alert_count desc;

-- ---------------------------------------------------------------------------
-- 2. Retention candidates mapped to runbook needs
-- ---------------------------------------------------------------------------
select
  e.domain, e.decision, e.cleanup_action, e.safety_level, e.status,
  count(*) as candidate_count,
  coalesce(sum(e.estimated_bytes), 0) as estimated_bytes,
  'pdf-import-retention-candidate-review-sop.md' as recommended_runbook
from public.pdf_import_retention_events e
where e.status in ('candidate', 'reviewed', 'approved_for_future_cleanup', 'blocked')
group by e.domain, e.decision, e.cleanup_action, e.safety_level, e.status
order by
  case e.decision when 'delete_candidate' then 1 when 'archive_candidate' then 2 when 'review' then 3 when 'blocked' then 4 else 5 end,
  candidate_count desc;

-- ---------------------------------------------------------------------------
-- 3. Operator decision states mapped to SOP needs
-- ---------------------------------------------------------------------------
select
  coalesce(ti.meta->'production_operator_control_audit'->'operatorState'->>'decision', 'missing') as operator_decision,
  coalesce(ti.meta->'production_operator_control_audit'->'operatorState'->>'manualReviewRequired', 'missing') as manual_review_required,
  coalesce(ti.meta->'production_operator_control_audit'->'operatorState'->>'blocked', 'missing') as operator_blocked,
  count(*) as import_count,
  case
    when ti.meta->'production_operator_control_audit'->'operatorState'->>'decision' in ('accepted', 'accepted_with_warnings') then 'pdf-import-golden-regression-review-sop.md'
    when ti.meta->'production_operator_control_audit'->'operatorState'->>'decision' in ('rejected', 'needs_rerun') then 'pdf-import-evaluate-persist-sop.md'
    when ti.meta->'production_operator_control_audit'->'operatorState'->>'decision' in ('manual_review_required', 'blocked') then 'pdf-import-incident-response-sop.md'
    else 'pdf-import-daily-operations-checklist.md'
  end as recommended_runbook
from public.template_imports ti
group by 1, 2, 3, 5
order by import_count desc;

-- ---------------------------------------------------------------------------
-- 4. Failed/stale imports requiring incident/import runbook
-- ---------------------------------------------------------------------------
select
  ti.id as import_id, ti.source_filename, ti.status, ti.error, ti.updated_at,
  now() - ti.updated_at as time_since_update,
  case
    when ti.status = 'failed' or ti.error is not null then 'pdf-import-incident-response-sop.md'
    when ti.status not in ('completed', 'failed') and ti.updated_at < now() - interval '30 minutes' then 'pdf-import-incident-response-sop.md'
    else 'none'
  end as recommended_runbook
from public.template_imports ti
where ti.status = 'failed'
   or ti.error is not null
   or (ti.status not in ('completed', 'failed') and ti.updated_at < now() - interval '30 minutes')
order by ti.updated_at desc
limit 100;

-- ---------------------------------------------------------------------------
-- 5. Export parity states requiring SOP coverage
-- ---------------------------------------------------------------------------
select
  coalesce(ti.meta->'export_parity_summary'->>'status', 'missing') as export_parity_status,
  count(*) as import_count,
  'pdf-import-export-parity-review-sop.md' as recommended_runbook
from public.template_imports ti
group by 1
order by import_count desc;

-- ---------------------------------------------------------------------------
-- 6. Adaptive reconciliation states requiring SOP coverage
-- ---------------------------------------------------------------------------
select
  coalesce(ti.meta->'adaptive_reconciliation_policy'->>'decision', 'missing') as adaptive_decision,
  count(*) as import_count,
  'pdf-import-adaptive-reconciliation-sop.md' as recommended_runbook
from public.template_imports ti
group by 1
order by import_count desc;

-- ---------------------------------------------------------------------------
-- 7. Self-healing action distribution requiring SOP coverage
-- ---------------------------------------------------------------------------
select
  action->>'safetyLevel' as safety_level,
  action->>'status' as action_status,
  count(*) as action_count,
  'pdf-import-self-healing-review-sop.md' as recommended_runbook
from public.template_imports ti
cross join lateral jsonb_array_elements(coalesce(ti.meta->'self_healing_retry_audit'->'actions', '[]'::jsonb)) as action
group by 1, 2
order by action_count desc;

-- ---------------------------------------------------------------------------
-- 8. Release gate database status requiring SOP coverage
-- ---------------------------------------------------------------------------
with signals as (
  select
    (select count(*) from public.pdf_import_monitoring_events where status in ('open', 'acknowledged') and severity = 'critical') as active_critical_alerts,
    (select count(*) from public.pdf_import_monitoring_events where status in ('open', 'acknowledged') and severity = 'high') as active_high_alerts,
    (select count(*) from public.template_imports where status = 'failed' or error is not null) as failed_imports,
    (select count(*) from public.pdf_import_jobs where status = 'failed') as failed_jobs
)
select
  active_critical_alerts, active_high_alerts, failed_imports, failed_jobs,
  case
    when active_critical_alerts > 0 then 'release_gate_would_fail_review_release_gate_failure_sop'
    when active_high_alerts > 0 or failed_imports > 0 or failed_jobs > 0 then 'release_gate_warning_review_release_gate_failure_sop'
    else 'release_gate_database_clear'
  end as release_gate_sop_signal,
  'pdf-import-release-gate-failure-sop.md' as recommended_runbook
from signals;

-- ---------------------------------------------------------------------------
-- 9. Runbook readiness operational rollup
-- ---------------------------------------------------------------------------
with signals as (
  select
    (select count(*) from public.pdf_import_monitoring_events where status in ('open', 'acknowledged') and severity = 'critical') as active_critical_alerts,
    (select count(*) from public.pdf_import_monitoring_events where status in ('open', 'acknowledged') and severity = 'high') as active_high_alerts,
    (select count(*) from public.pdf_import_retention_events where status in ('candidate', 'reviewed', 'approved_for_future_cleanup', 'blocked')) as active_retention_candidates,
    (select count(*) from public.template_imports where status = 'failed' or error is not null) as failed_imports,
    (select count(*) from public.pdf_import_jobs where status = 'failed') as failed_jobs,
    (select count(*) from public.template_imports ti where ti.meta->'production_operator_control_audit'->'operatorState'->>'decision' in ('manual_review_required', 'blocked')) as manual_or_blocked_operator_states
)
select
  active_critical_alerts, active_high_alerts, active_retention_candidates, failed_imports, failed_jobs, manual_or_blocked_operator_states,
  case
    when active_critical_alerts > 0 then 'runbooks_required_critical_incident_active'
    when active_high_alerts > 0 or failed_imports > 0 or failed_jobs > 0 then 'runbooks_required_high_priority_operations_active'
    when active_retention_candidates > 0 then 'runbooks_required_retention_review_active'
    when manual_or_blocked_operator_states > 0 then 'runbooks_required_manual_review_active'
    else 'runbook_operational_signals_clear'
  end as runbook_operational_readiness_signal
from signals;

-- ---------------------------------------------------------------------------
-- 10. Phase 11F note
-- ---------------------------------------------------------------------------
select
  'phase_11f_production_runbooks_sops' as phase,
  'This SQL maps database-side operational signals to required runbooks. Markdown file existence and runbook section completeness are validated by the TypeScript runbook registry/evaluator and local tests.' as note;
