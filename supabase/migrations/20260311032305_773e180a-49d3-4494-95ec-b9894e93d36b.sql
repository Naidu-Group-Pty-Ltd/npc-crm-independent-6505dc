-- Parse ghl_attribution_source JSON into individual columns for all existing backfill records
UPDATE public.lead_source_attributions
SET 
  utm_campaign = COALESCE(utm_campaign, (ghl_attribution_source::jsonb)->>'utmCampaign'),
  utm_medium = COALESCE(utm_medium, (ghl_attribution_source::jsonb)->>'utmMedium'),
  utm_content = COALESCE(utm_content, (ghl_attribution_source::jsonb)->>'utmContent'),
  utm_source = COALESCE(
    CASE WHEN utm_source = 'Facebook' THEN (ghl_attribution_source::jsonb)->>'utmSource' ELSE utm_source END,
    utm_source
  ),
  meta_campaign_id = COALESCE(meta_campaign_id, (ghl_attribution_source::jsonb)->>'campaignId'),
  meta_campaign_name = COALESCE(meta_campaign_name, (ghl_attribution_source::jsonb)->>'campaign'),
  meta_adset_id = COALESCE(meta_adset_id, (ghl_attribution_source::jsonb)->>'adSetId'),
  meta_adset_name = COALESCE(meta_adset_name, (ghl_attribution_source::jsonb)->>'utmMedium'),
  meta_ad_id = COALESCE(meta_ad_id, (ghl_attribution_source::jsonb)->>'adId'),
  meta_ad_name = COALESCE(meta_ad_name, (ghl_attribution_source::jsonb)->>'utmContent'),
  enrichment_status = CASE 
    WHEN (ghl_attribution_source::jsonb)->>'campaignId' IS NOT NULL THEN 'enriched'
    ELSE enrichment_status 
  END
WHERE ghl_attribution_source IS NOT NULL
  AND source_type = 'backfill'
  AND (meta_campaign_id IS NULL OR utm_campaign IS NULL);