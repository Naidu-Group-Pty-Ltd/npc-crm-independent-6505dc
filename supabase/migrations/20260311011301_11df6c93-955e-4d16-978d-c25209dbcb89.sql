
-- Create source_type enum
CREATE TYPE public.attribution_source_type AS ENUM ('webhook_auto', 'manual', 'csv_import');

-- Create lead_source_attributions table
CREATE TABLE public.lead_source_attributions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE NOT NULL,
  deal_id UUID REFERENCES public.client_deals(id) ON DELETE SET NULL,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_content TEXT,
  utm_term TEXT,
  meta_campaign_id TEXT,
  meta_adset_id TEXT,
  meta_ad_id TEXT,
  source_type attribution_source_type NOT NULL DEFAULT 'manual',
  landing_page_url TEXT,
  referrer_url TEXT,
  ghl_contact_id TEXT,
  attributed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.lead_source_attributions ENABLE ROW LEVEL SECURITY;

-- Index for fast lookups
CREATE INDEX idx_lead_source_attributions_client_id ON public.lead_source_attributions(client_id);
CREATE INDEX idx_lead_source_attributions_meta_campaign_id ON public.lead_source_attributions(meta_campaign_id);
CREATE INDEX idx_lead_source_attributions_utm_campaign ON public.lead_source_attributions(utm_campaign);

-- Updated_at trigger
CREATE TRIGGER update_lead_source_attributions_updated_at
  BEFORE UPDATE ON public.lead_source_attributions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
