-- Backfill property_comparisons.comparison_type for rows created before the
-- producer recorded it.
--
-- `compare-investment-reports` has stored the compared report family in
-- `comparison_type` since 2026-08-15, and refuses a mixed selection — but the
-- 50 rows from before that date carry NULL, so the library presented every
-- comparison as a generic "Comparison" with no way to tell a Compass
-- Comparison from a Briefing or Snapshot one.
--
-- The family is derived from the linked reports' own `report_tier`, normalised
-- with the same alias sets `normalizeComparableReportType` uses in
-- `supabase/functions/compare-investment-reports/index.ts`. A row is typed
-- ONLY when the evidence is complete and unanimous:
--
--   * every id in `report_ids` still resolves to an investment_reports row
--     (6 of 186 references dangle — see docs/reports/COMPARISON.md F11), and
--   * every linked report normalises to the SAME family.
--
-- A row with a dangling reference or genuinely mixed families (both exist —
-- the same-type rule postdates them) stays NULL and keeps presenting as an
-- untyped "Comparison". Absent evidence never merges.
--
-- Verified against production on 2026-08-26 inside a transaction that was
-- rolled back: 41 of 50 NULL rows update (all to 'compass'), leaving
-- 50 compass / 2 briefing / 9 untyped. Idempotent — a second run finds no
-- NULL rows it can type.

with links as (
  select pc.id as comparison_id,
    case
      when ir.id is null then null
      when lower(replace(replace(coalesce(ir.report_tier,''),' ','_'),'-','_')) in ('compass','composite','investment','investment_report','full') then 'compass'
      when lower(replace(replace(coalesce(ir.report_tier,''),' ','_'),'-','_')) in ('financial','fin','financial_report') then 'financial'
      when lower(replace(replace(coalesce(ir.report_tier,''),' ','_'),'-','_')) in ('strategic','strategy','pldd','property_level_due_diligence','due_diligence') then 'strategic'
      when lower(replace(replace(coalesce(ir.report_tier,''),' ','_'),'-','_')) in ('snapshot','snap','snp','overview','quick_snapshot') then 'snapshot'
      when lower(replace(replace(coalesce(ir.report_tier,''),' ','_'),'-','_')) in ('briefing','brief','brf','client_briefing') then 'briefing'
      else null
    end as kind
  from public.property_comparisons pc
  cross join lateral unnest(pc.report_ids) as rid
  left join public.investment_reports ir on ir.id::text = rid::text
  where pc.comparison_type is null
),
verdicts as (
  select comparison_id,
    min(kind) as sole_kind,
    -- count(distinct ...) ignores NULLs, so together with unknown_count = 0
    -- this is exact: one family, no missing or unmappable report.
    count(distinct kind) as kind_count,
    count(*) filter (where kind is null) as unknown_count
  from links
  group by comparison_id
)
update public.property_comparisons pc
set comparison_type = v.sole_kind
from verdicts v
where pc.id = v.comparison_id
  and v.unknown_count = 0
  and v.kind_count = 1;
