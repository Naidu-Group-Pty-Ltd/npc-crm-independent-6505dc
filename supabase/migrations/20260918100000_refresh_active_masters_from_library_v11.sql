-- Re-copy the ACTIVE report_templates rows from the v11 catalogue, exactly as
-- `20260917110000` did for v10 and for the same reason: adopted masters are
-- COPIES, and nothing else updates a copy after adoption.
--
-- What v11 changes reach the documents people already generate:
--   * running-head part numbers resolve at render time over the pages that
--     actually draw ("Part {{partNumber | pad2}}"), so a conditional page
--     that does not render no longer leaves a hole in the numbering — a real
--     three-property comparison shipped with its parts jumping 12 → 19;
--   * fixed-slot rows carry per-row/per-item conditionals, so an axis or a
--     basis fact the record does not hold drops its row instead of printing
--     an empty ruled stripe under a label;
--   * data-dependent comparison pages (the axis-reason pages, investor fit)
--     are conditional on holding at least one row, so no page renders as a
--     heading over nothing;
--   * the comparison verdict's "why there is no recommendation here" callout
--     always has a body (composed by the projection for structured rows too).
--
-- Mechanics are identical to the v10 refresh: the entry's current schema with
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
