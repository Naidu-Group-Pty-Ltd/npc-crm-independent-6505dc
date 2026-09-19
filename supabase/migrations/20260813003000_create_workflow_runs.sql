-- Run history for the Workflow Playground.
--
-- Two tables rather than one JSONB column, unlike `workflows.graph`: runs are
-- queried across rows ("what failed today", "how often does this workflow run"),
-- which is exactly the case a document column is bad at. Steps are a child table
-- so a long run does not make its parent row enormous.
--
-- Retention is deliberately not automatic here. A cleanup job belongs with the
-- other scheduled work, not hidden in a migration.

BEGIN;

CREATE TABLE IF NOT EXISTS public.workflow_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id uuid NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
  -- 'test' never performs an external call; 'live' may.
  mode text NOT NULL DEFAULT 'test',
  status text NOT NULL DEFAULT 'running',
  -- What started it: the trigger's data, or the sample input for a test run.
  trigger_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  halt_reason text,
  step_count integer NOT NULL DEFAULT 0,
  failed_step_count integer NOT NULL DEFAULT 0,
  duration_ms integer,
  started_by uuid,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CONSTRAINT workflow_runs_mode_check CHECK (mode IN ('test', 'live')),
  CONSTRAINT workflow_runs_status_check CHECK (status IN ('running', 'succeeded', 'failed', 'halted'))
);

COMMENT ON TABLE public.workflow_runs IS
  'One execution of a workflow. mode=test performs no external calls; see src/lib/workflow/runtime/performers.ts.';

CREATE INDEX IF NOT EXISTS workflow_runs_workflow_idx ON public.workflow_runs (workflow_id, started_at DESC);
CREATE INDEX IF NOT EXISTS workflow_runs_status_idx ON public.workflow_runs (status) WHERE status <> 'succeeded';

CREATE TABLE IF NOT EXISTS public.workflow_run_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.workflow_runs(id) ON DELETE CASCADE,
  -- Position in the run, so the timeline survives even if two steps share a ms.
  sequence integer NOT NULL,
  node_id text NOT NULL,
  -- Catalog id, stored so a result stays readable after the step is deleted.
  node_type text NOT NULL,
  label text NOT NULL,
  status text NOT NULL,
  resolved_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  output jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  missing_references text[] NOT NULL DEFAULT '{}',
  branch_taken text,
  simulation_note text,
  duration_ms integer NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workflow_run_steps_status_check
    CHECK (status IN ('succeeded', 'failed', 'skipped', 'simulated', 'halted')),
  CONSTRAINT workflow_run_steps_unique_sequence UNIQUE (run_id, sequence)
);

COMMENT ON COLUMN public.workflow_run_steps.resolved_config IS
  'Config after {{…}} resolution — what the step actually acted on. May contain data from the trigger.';

CREATE INDEX IF NOT EXISTS workflow_run_steps_run_idx ON public.workflow_run_steps (run_id, sequence);

ALTER TABLE public.workflow_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_run_steps ENABLE ROW LEVEL SECURITY;

-- Same access model as workflows: service_role for the broker, admins directly.
-- Run rows can hold resolved client data, so they are not more public than the
-- workflow that produced them.
DROP POLICY IF EXISTS workflow_runs_service_role_all ON public.workflow_runs;
CREATE POLICY workflow_runs_service_role_all ON public.workflow_runs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS workflow_run_steps_service_role_all ON public.workflow_run_steps;
CREATE POLICY workflow_run_steps_service_role_all ON public.workflow_run_steps
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Admins can view workflow runs" ON public.workflow_runs;
CREATE POLICY "Admins can view workflow runs" ON public.workflow_runs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role = ANY (ARRAY['superadmin'::public.app_role, 'admin'::public.app_role])
    )
  );

DROP POLICY IF EXISTS "Admins can view workflow run steps" ON public.workflow_run_steps;
CREATE POLICY "Admins can view workflow run steps" ON public.workflow_run_steps
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role = ANY (ARRAY['superadmin'::public.app_role, 'admin'::public.app_role])
    )
  );

COMMIT;
