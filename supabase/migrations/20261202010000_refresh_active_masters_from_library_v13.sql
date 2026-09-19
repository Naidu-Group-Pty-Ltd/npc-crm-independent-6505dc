-- Re-copy the ACTIVE report_templates rows from the v13 catalogue, exactly as
-- `20261112010000` did for v12 and for the same reason: adopted masters are
-- COPIES, and nothing else updates a copy after adoption. A library seed alone
-- changes what a NEW adoption gets and leaves every document people already
-- generate drawing the old page.
--
-- What v13 changes reach those documents: the Financial position page's cash
-- flow table now lists every line it subtracts. The engine charges eight
-- annual cost components and the table drew four, so on 262 Pallas Street,
-- Maryborough the printed rows came to $10,780 a year against a "Net position"
-- built on $12,880 — and the row that left water rates out was labelled
-- "Council and water rates". Water joins that row, letting fees join
-- management, and two conditional rows appear where there is a figure to draw:
-- land tax and strata (`financials.annualOtherCosts`) and the occupancy gap
-- (`financials.annualVacancyAllowance`).
--
-- Mechanics are identical to the v12 refresh: the entry's current schema with
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
