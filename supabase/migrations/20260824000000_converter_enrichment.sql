-- The converter's design pass, recorded.
--
-- Additive only. Every column below is nullable or defaulted, so a conversion
-- written before this migration reads back as "nothing was designed", which is
-- exactly what happened.
--
-- ## Why any of this is a column
--
-- The question that prompted the whole change was "is the converter running
-- this through Claude at all?", and at the time the honest answer — yes for the
-- transcription, no for anything after it — was not visible anywhere. Not on
-- the screen, not in the row. It had to be worked out by reading the render
-- path.
--
-- These five columns make it answerable from the history panel. That is worth
-- five columns: a feature whose value depends on a model doing something is a
-- feature that has to be able to say whether the model did it.

ALTER TABLE public.template_conversions
  -- 'restructure' | 'connective' | 'rewrite'. How much licence the design pass
  -- had with the words; figures are locked at every level. Nullable rather than
  -- defaulted to 'restructure', because a null here means "this row predates
  -- the design pass" and a 'restructure' would claim one ran.
  ADD COLUMN IF NOT EXISTS fidelity text
    CHECK (fidelity IS NULL OR fidelity IN ('restructure', 'connective', 'rewrite')),

  -- How many chapters printed designed blocks rather than flat Markdown. The
  -- single most useful number here: it is the difference between "the design
  -- pass ran" and "the design pass worked".
  ADD COLUMN IF NOT EXISTS enriched_chapters integer NOT NULL DEFAULT 0,

  -- The model that did it, or null when none ran. Named rather than assumed,
  -- because `ANTHROPIC_MODEL` is overridable per deploy and a conversion that
  -- reads oddly is worth being able to attribute.
  ADD COLUMN IF NOT EXISTS enrichment_model text,

  -- Counts per block kind — `{"kpi": 3, "table": 5, "bullet": 1}`. Cheap, and
  -- it answers "did it actually promote anything, or is it all prose?" without
  -- opening the PDF.
  ADD COLUMN IF NOT EXISTS enrichment_blocks jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Every guard rejection and fallback, in words. A guard that silently drops a
  -- chapter's design teaches nobody anything; this is where "rejected: it
  -- contains 2 figures the chapter does not: $2,480, 41%" is recorded.
  ADD COLUMN IF NOT EXISTS enrichment_notes text[] NOT NULL DEFAULT '{}',

  -- 'model' or 'scorer'. Which proposed the binding a person confirmed. The two
  -- deserve different amounts of scrutiny on the review screen and there was
  -- previously no way to tell them apart after the fact.
  ADD COLUMN IF NOT EXISTS binding_source text
    CHECK (binding_source IS NULL OR binding_source IN ('model', 'scorer'));

COMMENT ON COLUMN public.template_conversions.fidelity IS
  'How much licence the design pass had with the words: restructure (same words, new form), connective (may add ledes and sub-headings), rewrite (may rewrite prose). Figures are locked at every level and checked against the source. Null means the row predates the design pass.';

COMMENT ON COLUMN public.template_conversions.enriched_chapters IS
  'Chapters that printed designed blocks — KPI strips, tables, charts, callouts — rather than flat Markdown. Zero with a non-null enrichment_model means the pass ran and every chapter fell back.';

COMMENT ON COLUMN public.template_conversions.enrichment_notes IS
  'Guard rejections and fallbacks, per chapter, in words. Populated when a chapter invented a figure, returned only prose, or the design service failed.';
