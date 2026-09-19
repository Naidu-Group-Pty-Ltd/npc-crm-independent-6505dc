
-- Phase 2 (Live Rendering Migration): identify charts whose chart_config
-- contains a renderable payload, so producers/consumers can distinguish live
-- rows from legacy image-only rows without touching the client normaliser.
CREATE OR REPLACE FUNCTION public.chart_config_is_live(cfg jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN cfg IS NULL THEN false
    -- Producer schema v2: { data: [{ label, value, ... }] }
    WHEN jsonb_typeof(cfg -> 'data') = 'array'
         AND jsonb_array_length(cfg -> 'data') > 0
         AND (cfg -> 'data' -> 0 ? 'label' OR cfg -> 'data' -> 0 ? 'name')
      THEN true
    -- Chart.js style: { data: { labels: [...], datasets: [{ data: [...] }] } }
    WHEN jsonb_typeof(cfg -> 'data' -> 'labels') = 'array'
         AND jsonb_typeof(cfg -> 'data' -> 'datasets') = 'array'
         AND jsonb_array_length(cfg -> 'data' -> 'labels') > 0
      THEN true
    -- Flattened: top-level labels/datasets
    WHEN jsonb_typeof(cfg -> 'labels') = 'array'
         AND jsonb_typeof(cfg -> 'datasets') = 'array'
         AND jsonb_array_length(cfg -> 'labels') > 0
      THEN true
    ELSE false
  END;
$$;

COMMENT ON FUNCTION public.chart_config_is_live(jsonb) IS
  'Phase 2 helper: returns true when chart_config carries enough labels/values for the LiveChart kernel to render without falling back to image_data.';

-- Expression index so admin dashboards / backfill jobs can filter cheaply.
CREATE INDEX IF NOT EXISTS charts_live_config_idx
  ON public.charts (chart_config_is_live(chart_config));
