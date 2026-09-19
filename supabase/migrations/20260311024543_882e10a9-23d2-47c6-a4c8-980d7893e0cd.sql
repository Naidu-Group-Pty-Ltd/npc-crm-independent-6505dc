-- Add enrichment columns for detailed Meta Ads attribution
ALTER TABLE public.lead_source_attributions 
  ADD COLUMN IF NOT EXISTS meta_campaign_name text,
  ADD COLUMN IF NOT EXISTS meta_adset_name text,
  ADD COLUMN IF NOT EXISTS meta_ad_name text,
  ADD COLUMN IF NOT EXISTS meta_ad_creative_url text,
  ADD COLUMN IF NOT EXISTS meta_campaign_objective text,
  ADD COLUMN IF NOT EXISTS fbclid text,
  ADD COLUMN IF NOT EXISTS gclid text,
  ADD COLUMN IF NOT EXISTS ghl_attribution_source text,
  ADD COLUMN IF NOT EXISTS ghl_last_attribution_source text,
  ADD COLUMN IF NOT EXISTS conversion_page_url text,
  ADD COLUMN IF NOT EXISTS device_type text,
  ADD COLUMN IF NOT EXISTS geo_location text,
  ADD COLUMN IF NOT EXISTS enriched_at timestamptz,
  ADD COLUMN IF NOT EXISTS enrichment_status text DEFAULT 'pending';

-- Add index for enrichment queries
CREATE INDEX IF NOT EXISTS idx_lead_attr_enrichment_status 
  ON public.lead_source_attributions(enrichment_status) 
  WHERE enrichment_status = 'pending' AND meta_campaign_id IS NOT NULL;