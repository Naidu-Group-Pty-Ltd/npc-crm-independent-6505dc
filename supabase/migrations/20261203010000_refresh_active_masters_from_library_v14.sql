-- Re-copy the ACTIVE report_templates rows from the v14 catalogue, exactly as
-- `20261202010000` did for v13 and for the same reason: adopted masters are
-- COPIES, and nothing else updates a copy after adoption. A library seed alone
-- changes what a NEW adoption gets and leaves every document people already
-- generate drawing the old page.
--
-- What v14 changes reach those documents: the Investment masters stop drawing
-- the financial modelling on the tiers that may not carry it. One master
-- serves five document kinds, so the acquisition table, the cash flow and the
-- ten-year equity chart were drawn on all five — while
-- `compassSectionRegistry.ts` has said since v2.0 that "ALL detailed financial
-- modelling (purchase costs, yield, loan, cashflow, sensitivity, 10-year
-- projections, land tax, equity) lives in the separate Financial Analysis
-- Report and MUST NOT appear here". The generator obeyed that rule and the
-- master did not, so the Investment Compass opened on purchase price, gross
-- yield, LVR and a ten-year projection while the Financial Analysis carried
-- the location case: each report answering the other's question.
--
-- Those three pages now carry `conditional: report && report.drawsFinancialModelling`,
-- published by `reportBindingProjection` from `tierContent.pure.ts` — the one
-- module that decides what a tier contains. The projection also WITHHOLDS the
-- modelling bindings on those tiers, which is what makes the drop clean: a
-- page kept with nothing to bind prints labelled empty rows, which is worse
-- than a page the reader never sees. The contents list needs no change: the
-- `toc` block reads the pages that actually rendered.
--
-- Mechanics are identical to the v13 refresh: the entry's current schema with
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
