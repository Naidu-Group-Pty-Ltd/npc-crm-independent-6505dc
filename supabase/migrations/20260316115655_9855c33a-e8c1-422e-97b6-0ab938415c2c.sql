-- Store ALL GHL opportunities per client (not just one)
CREATE TABLE public.ghl_client_opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  ghl_opportunity_id text NOT NULL,
  ghl_contact_id text NOT NULL,
  pipeline_id uuid REFERENCES public.ghl_pipelines(id) ON DELETE SET NULL,
  stage_id uuid REFERENCES public.ghl_pipeline_stages(id) ON DELETE SET NULL,
  pipeline_name text,
  stage_name text,
  opportunity_status text DEFAULT 'open',
  monetary_value numeric DEFAULT 0,
  opportunity_name text,
  follow_up_date timestamptz,
  notes text,
  custom_fields jsonb,
  ghl_created_at timestamptz,
  ghl_updated_at timestamptz,
  synced_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(client_id, ghl_opportunity_id)
);

CREATE INDEX idx_ghl_client_opps_client_id ON public.ghl_client_opportunities(client_id);
CREATE INDEX idx_ghl_client_opps_pipeline_id ON public.ghl_client_opportunities(pipeline_id);
CREATE INDEX idx_ghl_client_opps_stage_id ON public.ghl_client_opportunities(stage_id);
CREATE INDEX idx_ghl_client_opps_ghl_contact ON public.ghl_client_opportunities(ghl_contact_id);

ALTER TABLE public.ghl_client_opportunities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read opportunities"
  ON public.ghl_client_opportunities FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Service role full access to opportunities"
  ON public.ghl_client_opportunities FOR ALL
  TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER update_ghl_client_opportunities_updated_at
  BEFORE UPDATE ON public.ghl_client_opportunities
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();