-- Remove stale duplicate pipelines from the old legacy GHL location.
-- The new GHL account's pipelines (location H7NNnJKSofGaRJHTkAd3) are the active ones,
-- and all client/opportunity references already point to those.
DELETE FROM public.ghl_pipeline_stages
WHERE pipeline_id IN (
  SELECT id FROM public.ghl_pipelines WHERE location_id = '8guFPPbpJXYFsw5HDG28'
);

DELETE FROM public.ghl_pipelines
WHERE location_id = '8guFPPbpJXYFsw5HDG28';