
-- Lead magnets catalogue
CREATE TABLE public.lead_magnets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  file_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size BIGINT,
  mime_type TEXT,
  ghl_pipeline_id TEXT,
  ghl_stage_id TEXT,
  ghl_tag TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  download_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_lead_magnets_slug ON public.lead_magnets(slug);
CREATE INDEX idx_lead_magnets_active ON public.lead_magnets(is_active);

ALTER TABLE public.lead_magnets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role only - lead_magnets"
  ON public.lead_magnets FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Lead capture log
CREATE TABLE public.lead_magnet_downloads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  magnet_id UUID NOT NULL REFERENCES public.lead_magnets(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  ip_address TEXT,
  user_agent TEXT,
  referrer TEXT,
  ghl_contact_id TEXT,
  ghl_synced BOOLEAN NOT NULL DEFAULT false,
  ghl_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_lmd_magnet ON public.lead_magnet_downloads(magnet_id);
CREATE INDEX idx_lmd_email ON public.lead_magnet_downloads(email);
CREATE INDEX idx_lmd_created ON public.lead_magnet_downloads(created_at DESC);

ALTER TABLE public.lead_magnet_downloads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role only - lead_magnet_downloads"
  ON public.lead_magnet_downloads FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- updated_at trigger
CREATE TRIGGER update_lead_magnets_updated_at
  BEFORE UPDATE ON public.lead_magnets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Private storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('lead-magnets', 'lead-magnets', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "service role only - lead-magnets storage"
  ON storage.objects FOR ALL
  USING (bucket_id = 'lead-magnets' AND auth.role() = 'service_role')
  WITH CHECK (bucket_id = 'lead-magnets' AND auth.role() = 'service_role');
