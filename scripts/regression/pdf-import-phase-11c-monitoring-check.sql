-- Phase 11C — PDF Import Monitoring + Alerting Activation check.
-- Run in the Supabase SQL Editor. This SQL is READ-ONLY and mutates nothing.
--
-- It validates the durable monitoring event ledger, its RLS posture, alert
-- lifecycle/severity distribution, dedupe integrity, privacy safety of the
-- stored context, and the live metric signals the `run_check` operation
-- consumes. It never triggers remediation.

-- ---------------------------------------------------------------------------
-- 1. Monitoring table presence
-- ---------------------------------------------------------------------------
select
  'pdf_import_monitoring_events' as object_name,
  to_regclass('public.pdf_import_monitoring_events') as object_regclass;

-- ---------------------------------------------------------------------------
-- 2. RLS enabled state on the monitoring table + core tables
-- ---------------------------------------------------------------------------
select
  n.nspname as schema_name,
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as force_rls
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'pdf_import_monitoring_events',
    'template_imports',
    'pdf_import_jobs',
    'pdf_import_golden_runs'
  )
order by c.relname;

-- ---------------------------------------------------------------------------
-- 3. Monitoring table RLS policies (expect service-role ALL + admin SELECT)
-- ---------------------------------------------------------------------------
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename = 'pdf_import_monitoring_events'
order by policyname;

-- ---------------------------------------------------------------------------
-- 4. Severity x status distribution of persisted alert events
-- ---------------------------------------------------------------------------
select
  severity,
  status,
  count(*) as event_count,
  sum(occurrence_count) as total_occurrences
from public.pdf_import_monitoring_events
group by severity, status
order by
  case severity when 'critical' then 0 when 'high' then 1 when 'warning' then 2 else 3 end,
  status;

-- ---------------------------------------------------------------------------
-- 5. Active alerts (open + acknowledged), most recent first
-- ---------------------------------------------------------------------------
select
  id, rule_id, domain, severity, status, release_blocking,
  occurrence_count, first_seen_at, last_seen_at, title
from public.pdf_import_monitoring_events
where status in ('open', 'acknowledged')
order by
  case severity when 'critical' then 0 when 'high' then 1 when 'warning' then 2 else 3 end,
  last_seen_at desc
limit 200;

-- ---------------------------------------------------------------------------
-- 6. Release-blocking active alerts (should be triaged before release)
-- ---------------------------------------------------------------------------
select
  count(*) as release_blocking_active_count,
  count(*) filter (where severity = 'critical') as critical_active,
  count(*) filter (where severity = 'high') as high_active
from public.pdf_import_monitoring_events
where status in ('open', 'acknowledged')
  and release_blocking = true;

-- ---------------------------------------------------------------------------
-- 7. Domain distribution across active alerts
-- ---------------------------------------------------------------------------
select domain, count(*) as active_alerts
from public.pdf_import_monitoring_events
where status in ('open', 'acknowledged')
group by domain
order by active_alerts desc, domain;

-- ---------------------------------------------------------------------------
-- 8. Dedupe integrity — no two live rows share an event_key
--    (live = open/acknowledged/suppressed; enforced by a partial unique index)
-- ---------------------------------------------------------------------------
select
  event_key,
  count(*) as live_rows
from public.pdf_import_monitoring_events
where status in ('open', 'acknowledged', 'suppressed')
group by event_key
having count(*) > 1
order by live_rows desc;

-- ---------------------------------------------------------------------------
-- 9. Privacy safety — the `context` jsonb must be flat safe scalars only.
--    Any nested object/array value is a privacy risk and should be zero.
-- ---------------------------------------------------------------------------
select
  count(*) as events_with_nested_context
from public.pdf_import_monitoring_events e
where exists (
  select 1
  from jsonb_each(e.context) kv
  where jsonb_typeof(kv.value) in ('object', 'array')
);

-- ---------------------------------------------------------------------------
-- 10. Live import-pipeline metric signals (mirror of run_check detection).
--     NOTE: pdf_import_jobs has NO import_id column — never join it to
--     template_imports. Use status / created_at / engine_version directly.
-- ---------------------------------------------------------------------------
select
  (select count(*) from public.pdf_import_jobs
     where status = 'failed' and created_at >= now() - interval '24 hours') as failed_imports_24h,
  (select count(*) from public.pdf_import_jobs
     where status = 'succeeded' and created_at >= now() - interval '24 hours') as completed_imports_24h,
  (select count(*) from public.pdf_import_jobs
     where status = 'queued' and created_at < now() - interval '30 minutes') as stuck_imports_over_30m,
  (select count(*) from public.pdf_import_jobs
     where status = 'succeeded' and engine_version is null) as completed_missing_engine_version;

-- ---------------------------------------------------------------------------
-- 11. Live golden-regression + security signals
-- ---------------------------------------------------------------------------
select
  (select count(*) from public.pdf_import_golden_runs where quality_gate_status = 'fail') as golden_gate_failed,
  (select count(*) from public.pdf_import_golden_runs where quality_gate_status = 'blocked') as golden_gate_blocked,
  (select count(*) from storage.buckets
     where id = 'template-import-artifacts' and public = true) as public_artifact_bucket_count;

-- ---------------------------------------------------------------------------
-- 12. Golden run readiness context (golden_runs → template_imports is a VALID
--     join because pdf_import_golden_runs.import_id references template_imports).
-- ---------------------------------------------------------------------------
select
  gr.quality_gate_status,
  count(*) as run_count,
  count(distinct gr.import_id) as distinct_imports
from public.pdf_import_golden_runs gr
left join public.template_imports ti on ti.id = gr.import_id
group by gr.quality_gate_status
order by run_count desc;

-- ---------------------------------------------------------------------------
-- 13. Monitoring readiness rollup
-- ---------------------------------------------------------------------------
with signals as (
  select
    (select case when to_regclass('public.pdf_import_monitoring_events') is not null then 1 else 0 end) as table_exists,
    (select count(*) from public.pdf_import_monitoring_events
       where status in ('open', 'acknowledged') and release_blocking = true and severity in ('critical', 'high')) as release_blocking_active,
    (select count(*) from public.pdf_import_monitoring_events e
       where exists (select 1 from jsonb_each(e.context) kv where jsonb_typeof(kv.value) in ('object', 'array'))) as nested_context_rows,
    (select count(*) from (
       select event_key from public.pdf_import_monitoring_events
       where status in ('open', 'acknowledged', 'suppressed')
       group by event_key having count(*) > 1
     ) d) as duplicate_live_keys,
    (select count(*) from storage.buckets where id = 'template-import-artifacts' and public = true) as public_bucket_count
)
select
  table_exists,
  release_blocking_active,
  nested_context_rows,
  duplicate_live_keys,
  public_bucket_count,
  case
    when table_exists = 0 then 'monitoring_not_installed'
    when nested_context_rows > 0 then 'monitoring_privacy_risk_nested_context'
    when duplicate_live_keys > 0 then 'monitoring_dedupe_integrity_violation'
    when public_bucket_count > 0 then 'monitoring_active_public_bucket_exposure'
    when release_blocking_active > 0 then 'monitoring_active_release_blocking_alerts'
    else 'monitoring_healthy_ready'
  end as monitoring_status
from signals;

-- ---------------------------------------------------------------------------
-- 14. Phase 11C note
-- ---------------------------------------------------------------------------
select
  'phase_11c_monitoring_alerting_activation' as phase,
  'Read-only database checks only. Source-code rules/evaluator, the pdf-import-monitoring edge function, permission gating, and UI lifecycle actions must also be reviewed.' as note;
