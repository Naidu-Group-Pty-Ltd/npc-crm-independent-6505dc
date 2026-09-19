-- Lightweight per-workflow rebuild tracking for the visualizer
ALTER TABLE public.ghl_workflow_snapshots
  ADD COLUMN IF NOT EXISTS rebuild_notes text,
  ADD COLUMN IF NOT EXISTS rebuild_marked_done_at timestamptz,
  ADD COLUMN IF NOT EXISTS rebuild_marked_done_by uuid;

CREATE INDEX IF NOT EXISTS idx_ghl_workflow_snapshots_account_name
  ON public.ghl_workflow_snapshots (account, name);