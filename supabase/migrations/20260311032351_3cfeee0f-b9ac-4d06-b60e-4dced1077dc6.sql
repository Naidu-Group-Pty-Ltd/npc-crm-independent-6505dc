-- Parse ghl_attribution_source text (JSON) into individual columns
UPDATE public.lead_source_attributions
SET 
  utm_campaign = COALESCE(utm_campaign, (ghl_attribution_source::jsonb)->>'utmCampaign', (ghl_attribution_source::jsonb)->>'campaign'),
  utm_medium = COALESCE(utm_medium, (ghl_attribution_source::jsonb)->>'utmMedium'),
  utm_content = COALESCE(utm_content, (ghl_attribution_source::jsonb)->>'utmContent'),
  meta_campaign_id = COALESCE(meta_campaign_id, (ghl_attribution_source::jsonb)->>'campaignId'),
  meta_campaign_name = COALESCE(meta_campaign_name, (ghl_attribution_source::jsonb)->>'campaign'),
  meta_adset_id = COALESCE(meta_adset_id, (ghl_attribution_source::jsonb)->>'adSetId'),
  meta_adset_name = COALESCE(meta_adset_name, (ghl_attribution_source::jsonb)->>'utmMedium'),
  meta_ad_id = COALESCE(meta_ad_id, NULLIF((ghl_attribution_source::jsonb)->>'adId', 'null')),
  meta_ad_name = COALESCE(meta_ad_name, (ghl_attribution_source::jsonb)->>'utmContent')
WHERE ghl_attribution_source IS NOT NULL
  AND ghl_attribution_source != ''
  AND ghl_attribution_source LIKE '{%'
  AND source_type = 'backfill';