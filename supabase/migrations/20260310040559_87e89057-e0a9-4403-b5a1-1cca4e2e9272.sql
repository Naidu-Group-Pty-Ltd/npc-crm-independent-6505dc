ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS lead_source text;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS lead_source_campaign text;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS lead_source_detail text;

COMMENT ON COLUMN public.clients.lead_source IS 'Source platform of the lead (e.g., facebook, google, referral, organic)';
COMMENT ON COLUMN public.clients.lead_source_campaign IS 'Campaign name/ID from the ad platform that generated the lead';
COMMENT ON COLUMN public.clients.lead_source_detail IS 'Additional source detail (e.g., ad set name, ad name, UTM parameters)';