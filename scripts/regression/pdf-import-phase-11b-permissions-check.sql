-- Phase 11B Role-Based Operator Permissions Check
-- Run in Supabase SQL Editor.
--
-- Purpose:
-- Database-side readiness check for PDF import operator permissions.
--
-- This SQL is read-only.
-- It does not mutate production data.

-- ---------------------------------------------------------------------------
-- 1. Detect existing role/profile tables
-- ---------------------------------------------------------------------------
select
  'profiles' as object_name,
  to_regclass('public.profiles') as object_regclass
union all
select
  'user_roles',
  to_regclass('public.user_roles')
union all
select
  'organization_members',
  to_regclass('public.organization_members')
union all
select
  'team_members',
  to_regclass('public.team_members')
union all
select
  'pdf_import_operator_roles',
  to_regclass('public.pdf_import_operator_roles');

-- ---------------------------------------------------------------------------
-- 2. Relevant public table RLS enabled state
-- ---------------------------------------------------------------------------
select
  n.nspname as schema_name,
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as force_rls
from pg_class c
join pg_namespace n
  on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'template_imports',
    'report_templates',
    'pdf_import_jobs',
    'pdf_import_golden_runs',
    'profiles',
    'user_roles',
    'organization_members',
    'team_members',
    'pdf_import_operator_roles'
  )
order by c.relname;

-- ---------------------------------------------------------------------------
-- 3. Relevant RLS policies
-- ---------------------------------------------------------------------------
select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'template_imports',
    'report_templates',
    'pdf_import_jobs',
    'pdf_import_golden_runs',
    'profiles',
    'user_roles',
    'organization_members',
    'team_members',
    'pdf_import_operator_roles'
  )
order by tablename, policyname;

-- ---------------------------------------------------------------------------
-- 4. Latest operator control audits with decision state
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.status,
  ti.source_filename,
  ti.created_template_id as template_id,
  ti.meta->'production_operator_control_audit'->'operatorState'->>'decision' as operator_decision,
  ti.meta->'production_operator_control_audit'->'operatorState'->>'manualReviewRequired' as manual_review_required,
  ti.meta->'production_operator_control_audit'->'operatorState'->>'blocked' as operator_blocked,
  ti.meta->'production_operator_control_audit'->'operatorState'->>'lastActionId' as last_action_id,
  ti.meta->'production_operator_control_audit'->'operatorState'->>'lastActionAt' as last_action_at,
  ti.updated_at
from public.template_imports ti
where ti.meta ? 'production_operator_control_audit'
order by ti.updated_at desc
limit 100;

-- ---------------------------------------------------------------------------
-- 5. Operator controls that would require elevated permissions
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.source_filename,
  control->>'controlId' as control_id,
  control->>'state' as control_state,
  control->>'safetyLevel' as safety_level,
  control->>'requiresConfirmation' as requires_confirmation,
  control->>'recommended' as recommended,
  control->>'reason' as reason,
  control->>'blockedReason' as blocked_reason,
  case
    when control->>'controlId' in (
      'mark_accepted',
      'mark_accepted_with_warnings',
      'mark_rejected',
      'mark_blocked',
      'persist_golden_regression_summary',
      'save_golden_run_history',
      'run_self_healing_execute_safe',
      'run_export_parity_automation'
    ) then 'requires_pdf_admin_or_developer_admin'
    when control->>'controlId' in (
      'run_ai_reconciliation_manual',
      'apply_repair_manual',
      'apply_reconciliation_manual',
      'rerun_import_manual'
    ) then 'manual_workflow_permission_required'
    when control->>'controlId' in (
      'inspect_logs',
      'inspect_storage_artifacts'
    ) then 'developer_admin_required'
    else 'standard_or_read_only'
  end as expected_permission_tier,
  ti.updated_at
from public.template_imports ti
cross join lateral jsonb_array_elements(
  coalesce(ti.meta->'production_operator_control_audit'->'controls', '[]'::jsonb)
) as control
where ti.meta ? 'production_operator_control_audit'
order by ti.updated_at desc
limit 300;

-- ---------------------------------------------------------------------------
-- 6. Suspicious completed manual/blocked operator controls
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.source_filename,
  control->>'controlId' as control_id,
  control->>'safetyLevel' as safety_level,
  control->>'state' as control_state,
  control->>'reason' as reason,
  control->>'blockedReason' as blocked_reason,
  case
    when control->>'controlId' in (
      'run_ai_reconciliation_manual',
      'apply_repair_manual',
      'apply_reconciliation_manual',
      'rerun_import_manual'
    )
      and control->>'state' = 'completed'
    then 'critical_manual_control_completed_automatically'
    when control->>'safetyLevel' = 'blocked'
      and control->>'state' in ('available', 'recommended', 'completed')
    then 'critical_blocked_control_available'
    else 'pass'
  end as operator_control_permission_safety_status,
  ti.updated_at
from public.template_imports ti
cross join lateral jsonb_array_elements(
  coalesce(ti.meta->'production_operator_control_audit'->'controls', '[]'::jsonb)
) as control
where ti.meta ? 'production_operator_control_audit'
  and (
    control->>'controlId' in (
      'run_ai_reconciliation_manual',
      'apply_repair_manual',
      'apply_reconciliation_manual',
      'rerun_import_manual'
    )
    or control->>'safetyLevel' = 'blocked'
  )
order by ti.updated_at desc
limit 300;

-- ---------------------------------------------------------------------------
-- 7. Executed operator actions requiring audit review
-- ---------------------------------------------------------------------------
select
  ti.id as import_id,
  ti.source_filename,
  action->>'actionId' as action_id,
  action->>'controlId' as control_id,
  action->>'status' as action_status,
  action->>'message' as message,
  action->>'executedAt' as executed_at,
  case
    when action->>'controlId' in (
      'mark_accepted',
      'mark_accepted_with_warnings',
      'mark_rejected',
      'mark_blocked'
    ) then 'decision_write'
    when action->>'controlId' in (
      'run_ai_reconciliation_manual',
      'apply_repair_manual',
      'apply_reconciliation_manual',
      'rerun_import_manual'
    ) then 'manual_workflow_review'
    else 'standard'
  end as action_permission_category,
  ti.updated_at
from public.template_imports ti
cross join lateral jsonb_array_elements(
  coalesce(ti.meta->'production_operator_control_audit'->'executedActions', '[]'::jsonb)
) as action
where ti.meta ? 'production_operator_control_audit'
order by ti.updated_at desc
limit 300;

-- ---------------------------------------------------------------------------
-- 8. Admin route / permission rollout proxy through metadata coverage
-- ---------------------------------------------------------------------------
select
  count(*) as total_imports,
  count(*) filter (where meta ? 'production_operator_control_audit') as imports_with_operator_control_audit,
  count(*) filter (
    where meta->'production_operator_control_audit'->'operatorState'->>'decision' in (
      'accepted',
      'accepted_with_warnings',
      'rejected',
      'blocked',
      'manual_review_required'
    )
  ) as imports_with_operator_decisions,
  count(*) filter (
    where meta->'production_operator_control_audit'->'operatorState'->>'decision' = 'accepted'
  ) as accepted_count,
  count(*) filter (
    where meta->'production_operator_control_audit'->'operatorState'->>'decision' = 'blocked'
  ) as blocked_count
from public.template_imports;

-- ---------------------------------------------------------------------------
-- 9. Storage bucket safety remains required for permission rollout
-- ---------------------------------------------------------------------------
select
  b.id as bucket_id,
  b.name,
  b.public,
  case
    when b.id = 'template-import-artifacts' and b.public = true then 'critical_public_template_import_artifacts_bucket'
    when b.id = 'template-import-artifacts' and b.public = false then 'pass_private_bucket'
    else 'review'
  end as bucket_safety_status,
  b.created_at,
  b.updated_at
from storage.buckets b
where b.id = 'template-import-artifacts'
   or b.name ilike '%template%'
   or b.name ilike '%import%'
   or b.name ilike '%pdf%';

-- ---------------------------------------------------------------------------
-- 10. Permission readiness rollup
-- ---------------------------------------------------------------------------
with signals as (
  select
    (select count(*) from storage.buckets where id = 'template-import-artifacts' and public = true) as public_import_artifact_bucket_count,

    (
      select count(*)
      from public.template_imports ti
      cross join lateral jsonb_array_elements(coalesce(ti.meta->'production_operator_control_audit'->'controls', '[]'::jsonb)) c
      where c->>'controlId' in ('run_ai_reconciliation_manual', 'apply_repair_manual', 'apply_reconciliation_manual', 'rerun_import_manual')
        and c->>'state' = 'completed'
    ) as manual_operator_control_completed_count,

    (
      select count(*)
      from public.template_imports ti
      cross join lateral jsonb_array_elements(coalesce(ti.meta->'production_operator_control_audit'->'controls', '[]'::jsonb)) c
      where c->>'safetyLevel' = 'blocked'
        and c->>'state' in ('available', 'recommended', 'completed')
    ) as blocked_control_available_count,

    (select case when to_regclass('public.profiles') is not null then 1 else 0 end) as profiles_table_exists,
    (select case when to_regclass('public.user_roles') is not null then 1 else 0 end) as user_roles_table_exists,
    (select case when to_regclass('public.pdf_import_operator_roles') is not null then 1 else 0 end) as pdf_import_operator_roles_table_exists
)
select
  public_import_artifact_bucket_count,
  manual_operator_control_completed_count,
  blocked_control_available_count,
  profiles_table_exists,
  user_roles_table_exists,
  pdf_import_operator_roles_table_exists,
  case
    when public_import_artifact_bucket_count > 0
      or manual_operator_control_completed_count > 0
      or blocked_control_available_count > 0
    then 'permission_rollout_not_ready'
    when profiles_table_exists = 0
      and user_roles_table_exists = 0
      and pdf_import_operator_roles_table_exists = 0
    then 'permission_rollout_ready_with_conditions_no_role_table_detected'
    else 'permission_rollout_ready_for_admin_limited'
  end as permission_rollout_status
from signals;

-- ---------------------------------------------------------------------------
-- 11. Phase 11B note
-- ---------------------------------------------------------------------------
select
  'phase_11b_role_based_operator_permissions' as phase,
  'This SQL checks database-side permission readiness signals only. Source-code permission matrix, route guards, Edge Function operation guards, and frontend UI gating must also be reviewed.' as note;
