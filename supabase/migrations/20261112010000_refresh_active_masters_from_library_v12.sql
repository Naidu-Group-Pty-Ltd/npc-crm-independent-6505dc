-- Re-copy the ACTIVE report_templates rows from the v12 catalogue, exactly as
-- `20260918100000` did for v11 and for the same reason: adopted masters are
-- COPIES, and nothing else updates a copy after adoption.
--
-- What v12 changes reach the documents people already generate:
--   * the verdict sentence is COMPOSED, never interpolated — the two verdict
--     bodies bind `recommendation.gradedLine` / `.gradedDetailLine`, which
--     the projection publishes only when the record holds both a grade and a
--     score, and whose weighting clause names the dimensions THIS score
--     actually carries. A row without a score no longer prints
--     "Graded  at  out of 100" with the holes left in (shipped on every
--     Due Diligence fork ever produced), and a variant score is no longer
--     described with the composite's five dimensions.
--
-- Mechanics are identical to the v11 refresh: the entry's current schema with
-- THIS ROW'S OWN token colours carried forward (the colourway bake is exactly
-- that merge, so no palette is invented), and the lineage's entryVersion
-- advanced so the picker keeps recognising the copy. Rows with no library
-- lineage, inactive drafts, and rows whose entry the library no longer lists
-- are untouched. Idempotent.

update public.report_templates t
set
  schema = jsonb_set(
    e.schema,
    '{tokens,colors}',
    coalesce(t.schema -> 'tokens' -> 'colors', e.schema -> 'tokens' -> 'colors', '{}'::jsonb)
  ),
  config = jsonb_set(
    t.config,
    '{libraryLineage,entryVersion}',
    to_jsonb(e.version)
  ),
  updated_at = now()
from public.template_library_entries e
where t.is_active
  and (t.config -> 'libraryLineage' ->> 'entryId') = e.id::text
  and e.status = 'published'
  and e.schema is not null;
