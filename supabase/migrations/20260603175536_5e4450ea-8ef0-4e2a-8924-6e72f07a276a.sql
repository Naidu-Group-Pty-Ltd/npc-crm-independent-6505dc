
CREATE TABLE public.report_visual_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL,
  section_key text NOT NULL,
  section_title text NOT NULL,
  prompt_hash text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','ready','failed')),
  storage_path text,
  public_url text,
  error text,
  attempts int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (report_id, section_key)
);

GRANT ALL ON public.report_visual_assets TO service_role;

ALTER TABLE public.report_visual_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service role only" ON public.report_visual_assets
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX idx_rva_report ON public.report_visual_assets (report_id);
CREATE INDEX idx_rva_report_status ON public.report_visual_assets (report_id, status);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_rva_updated_at
  BEFORE UPDATE ON public.report_visual_assets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
