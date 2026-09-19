ALTER TABLE public.ghl_workflow_snapshots
  ADD COLUMN IF NOT EXISTS rebuild_blueprint jsonb;