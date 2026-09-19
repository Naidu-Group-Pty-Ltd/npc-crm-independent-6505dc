ALTER TABLE public.ghl_marketing_raw_dumps
  ADD COLUMN IF NOT EXISTS markdown_content text,
  ADD COLUMN IF NOT EXISTS raw_html_content text,
  ADD COLUMN IF NOT EXISTS screenshot_url text,
  ADD COLUMN IF NOT EXISTS links jsonb,
  ADD COLUMN IF NOT EXISTS metadata jsonb,
  ADD COLUMN IF NOT EXISTS submissions_sample jsonb,
  ADD COLUMN IF NOT EXISTS enrichment_sources jsonb;