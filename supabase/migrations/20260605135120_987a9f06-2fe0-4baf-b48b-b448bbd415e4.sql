
-- Report Generation Engine: observability + agentic editor tables

CREATE TABLE public.report_generation_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  report_id UUID,
  scope TEXT,
  variant TEXT,
  engine_version TEXT,
  trigger_source TEXT,
  template_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  registry_snapshot JSONB,
  system_prompt TEXT,
  data_packet JSONB,
  data_packet_hash TEXT,
  data_packet_size_bytes INTEGER,
  model TEXT,
  total_prompt_tokens INTEGER NOT NULL DEFAULT 0,
  total_completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_cost_cents NUMERIC(12,4) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'running',
  error TEXT,
  initiated_by UUID,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_rgr_report ON public.report_generation_runs(report_id, started_at DESC);
CREATE INDEX idx_rgr_status ON public.report_generation_runs(status, started_at DESC);
GRANT ALL ON public.report_generation_runs TO service_role;
ALTER TABLE public.report_generation_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role full access on rgr" ON public.report_generation_runs FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE public.report_generation_chunks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES public.report_generation_runs(id) ON DELETE CASCADE,
  section_key TEXT NOT NULL,
  section_label TEXT,
  ordinal INTEGER NOT NULL DEFAULT 0,
  phase TEXT,
  model TEXT,
  system_prompt TEXT,
  user_prompt TEXT,
  user_prompt_size_bytes INTEGER,
  attached_template_chunk_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  attached_packet_keys TEXT[] NOT NULL DEFAULT '{}',
  retrieval_meta JSONB,
  response TEXT,
  response_size_bytes INTEGER,
  tool_calls JSONB,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER,
  retry_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'completed',
  error TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_rgc_run ON public.report_generation_chunks(run_id, ordinal);
CREATE INDEX idx_rgc_section ON public.report_generation_chunks(section_key);
GRANT ALL ON public.report_generation_chunks TO service_role;
ALTER TABLE public.report_generation_chunks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role full access on rgc" ON public.report_generation_chunks FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE public.report_engine_proposals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  target_kind TEXT NOT NULL,
  target_id TEXT,
  before_value JSONB,
  after_value JSONB,
  patch JSONB,
  rationale TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  proposed_by_agent BOOLEAN NOT NULL DEFAULT true,
  proposed_by_user UUID,
  applied_by_user UUID,
  applied_at TIMESTAMPTZ,
  rejected_at TIMESTAMPTZ,
  rejection_reason TEXT,
  conversation_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_rep_status ON public.report_engine_proposals(status, created_at DESC);
GRANT ALL ON public.report_engine_proposals TO service_role;
ALTER TABLE public.report_engine_proposals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role full access on rep" ON public.report_engine_proposals FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE public.report_engine_audit (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  proposal_id UUID REFERENCES public.report_engine_proposals(id) ON DELETE SET NULL,
  target_kind TEXT NOT NULL,
  target_id TEXT,
  before_value JSONB,
  after_value JSONB,
  performed_by UUID,
  performed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  rationale TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_rea_target ON public.report_engine_audit(target_kind, target_id, performed_at DESC);
GRANT ALL ON public.report_engine_audit TO service_role;
ALTER TABLE public.report_engine_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role full access on rea" ON public.report_engine_audit FOR ALL TO service_role USING (true) WITH CHECK (true);

-- updated_at trigger for proposals
CREATE OR REPLACE FUNCTION public.touch_report_engine_proposal()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$
LANGUAGE plpgsql SET search_path = public;
CREATE TRIGGER trg_touch_report_engine_proposal
BEFORE UPDATE ON public.report_engine_proposals
FOR EACH ROW EXECUTE FUNCTION public.touch_report_engine_proposal();

-- Realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE public.report_generation_runs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.report_generation_chunks;
ALTER PUBLICATION supabase_realtime ADD TABLE public.report_engine_proposals;
ALTER TABLE public.report_generation_runs REPLICA IDENTITY FULL;
ALTER TABLE public.report_generation_chunks REPLICA IDENTITY FULL;
ALTER TABLE public.report_engine_proposals REPLICA IDENTITY FULL;
