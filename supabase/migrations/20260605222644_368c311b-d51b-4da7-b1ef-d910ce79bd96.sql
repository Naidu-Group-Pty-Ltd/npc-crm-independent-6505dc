CREATE TABLE IF NOT EXISTS public.template_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES public.report_templates(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  template_version INTEGER,
  page_id TEXT,
  block_id TEXT,
  share_token TEXT,
  actor_id UUID,
  actor_name TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT ALL ON public.template_events TO service_role;

ALTER TABLE public.template_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_template_events"
  ON public.template_events
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_template_events_template_created
  ON public.template_events(template_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_template_events_template_type
  ON public.template_events(template_id, event_type);

CREATE INDEX IF NOT EXISTS idx_template_events_share_token
  ON public.template_events(share_token)
  WHERE share_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_template_events_block
  ON public.template_events(template_id, block_id)
  WHERE block_id IS NOT NULL;