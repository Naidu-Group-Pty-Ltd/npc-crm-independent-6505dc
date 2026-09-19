-- ===========================================================================
-- GHL Workflow Migration — Phase 1: Snapshot + Enrollment Mirror
-- ===========================================================================
-- 1. ghl_workflow_snapshots: stateful snapshot of workflows from BOTH accounts
-- 2. ghl_contact_workflow_enrollments: mirror of who-was-in-what (legacy)
-- 3. Extend migration_jobs.domain enum to allow 'workflows_snapshot' and
--    'workflow_enrollments_backfill' and 'workflow_reenroll'.
-- 4. Add 'workflow' to ghl_id_mapping.resource_type usage (no constraint —
--    that column is free-form text).
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.ghl_workflow_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account text NOT NULL CHECK (account IN ('legacy','new')),
  workflow_id text NOT NULL,
  location_id text,
  name text,
  status text,                -- 'published' | 'draft' | etc, raw from GHL
  version integer,
  raw_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- snapshot bookkeeping
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  fetched_at timestamptz NOT NULL DEFAULT now(),
  -- once the legacy account is gone we may want to mark stale rows
  is_stale boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account, workflow_id)
);

CREATE INDEX IF NOT EXISTS idx_ghl_workflow_snapshots_account ON public.ghl_workflow_snapshots(account);
CREATE INDEX IF NOT EXISTS idx_ghl_workflow_snapshots_name_lower ON public.ghl_workflow_snapshots(account, lower(name));

ALTER TABLE public.ghl_workflow_snapshots ENABLE ROW LEVEL SECURITY;
-- Service-role only (per project standard). No client-side reads.
DROP POLICY IF EXISTS "service_role_all_workflow_snapshots" ON public.ghl_workflow_snapshots;
CREATE POLICY "service_role_all_workflow_snapshots"
  ON public.ghl_workflow_snapshots FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE TRIGGER trg_ghl_workflow_snapshots_updated_at
  BEFORE UPDATE ON public.ghl_workflow_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- Contact ↔ workflow enrollment mirror (legacy account)
-- This is the "system of record" once the legacy account is gone.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ghl_contact_workflow_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account text NOT NULL CHECK (account IN ('legacy','new')),
  contact_id text NOT NULL,
  workflow_id text NOT NULL,
  status text,                -- active | finished | removed | unknown
  enrolled_at timestamptz,
  -- tracking re-enrollment into the new account
  re_enrollment_status text NOT NULL DEFAULT 'pending'
    CHECK (re_enrollment_status IN ('pending','succeeded','failed','skipped','blocked')),
  re_enrollment_attempted_at timestamptz,
  re_enrollment_error text,
  new_contact_id text,        -- resolved at re-enrollment time
  new_workflow_id text,       -- resolved at re-enrollment time
  raw_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account, contact_id, workflow_id)
);

CREATE INDEX IF NOT EXISTS idx_gcwe_workflow ON public.ghl_contact_workflow_enrollments(account, workflow_id);
CREATE INDEX IF NOT EXISTS idx_gcwe_contact ON public.ghl_contact_workflow_enrollments(account, contact_id);
CREATE INDEX IF NOT EXISTS idx_gcwe_re_status ON public.ghl_contact_workflow_enrollments(re_enrollment_status);

ALTER TABLE public.ghl_contact_workflow_enrollments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_workflow_enrollments" ON public.ghl_contact_workflow_enrollments;
CREATE POLICY "service_role_all_workflow_enrollments"
  ON public.ghl_contact_workflow_enrollments FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE TRIGGER trg_gcwe_updated_at
  BEFORE UPDATE ON public.ghl_contact_workflow_enrollments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- Extend migration_jobs.domain to allow our 3 workflow phases.
-- ---------------------------------------------------------------------------
ALTER TABLE public.migration_jobs DROP CONSTRAINT IF EXISTS migration_jobs_domain_check;
ALTER TABLE public.migration_jobs ADD CONSTRAINT migration_jobs_domain_check
  CHECK (domain = ANY (ARRAY[
    'contacts','opportunities','conversations','conversations_replay',
    'notes','tasks','appointments','calendar_groups','calendars','bookings',
    'workflows_snapshot','workflow_enrollments_backfill','workflow_reenroll'
  ]));