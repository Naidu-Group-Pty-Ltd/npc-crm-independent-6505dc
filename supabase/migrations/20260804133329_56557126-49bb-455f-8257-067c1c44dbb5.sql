ALTER TABLE public.template_conversions
  ADD COLUMN IF NOT EXISTS fidelity text
    CHECK (fidelity IS NULL OR fidelity IN ('restructure', 'connective', 'rewrite')),
  ADD COLUMN IF NOT EXISTS enriched_chapters integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS enrichment_model text,
  ADD COLUMN IF NOT EXISTS enrichment_blocks jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS enrichment_notes text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS binding_source text
    CHECK (binding_source IS NULL OR binding_source IN ('model', 'scorer'));

COMMENT ON COLUMN public.template_conversions.fidelity IS
  'How much licence the design pass had with the words: restructure (same words, new form), connective (may add ledes and sub-headings), rewrite (may rewrite prose). Figures are locked at every level and checked against the source. Null means the row predates the design pass.';

COMMENT ON COLUMN public.template_conversions.enriched_chapters IS
  'Chapters that printed designed blocks — KPI strips, tables, charts, callouts — rather than flat Markdown. Zero with a non-null enrichment_model means the pass ran and every chapter fell back.';

COMMENT ON COLUMN public.template_conversions.enrichment_notes IS
  'Guard rejections and fallbacks, per chapter, in words. Populated when a chapter invented a figure, returned only prose, or the design service failed.';