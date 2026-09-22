-- Clear the supply register of the grains it mislabelled, and let it reload.
--
-- ## DO NOT APPLY THIS BEFORE THE PARSER FIX IS DEPLOYED
--
-- The order is the rule `20261214000000` was written for and it bites twice:
-- `market-sales-ingest` must be carrying the corrected `grainOfAreaCode`
-- before this runs. Applied against the old parser, the nightly reload writes
-- exactly the rows this deletes, and the register ends up where it started
-- while looking repaired.
--
-- Deployed-parser check, before applying:
--
--     the live bundle must contain `isStorableGrain` — it is exported beside
--     the corrected classifier and absent from every earlier version.
--
-- ## What it removes and why the predicate is a SOURCE and not a rule
--
-- The first production load filed an SA3 as `lga` and an SA4 as `sa2`. The
-- obvious cleanup is a DELETE whose WHERE clause restates the corrected
-- grain rule in SQL — and that would be a second implementation of
-- `grainOfAreaCode`, which is the defect this programme records against
-- `riskRegisterInstruction`, `strategySectionRules` and `AML_COMMAND_REFRESH`:
-- **a rule written at both ends is how the two ends drift.**
--
-- So the predicate is the SOURCE, not the shape of a code. Every row the
-- SA2-grain flow wrote is removed, and the corrected parser rewrites the ones
-- that belong — which is safe because this register is a pure projection of a
-- public download, holds nothing a person typed, and reloads on its own
-- schedule. `market_sales_medians` and every other register are untouched.
--
-- The `state` and `national` rollups go too, deliberately: they were written
-- by the same flow in the same response, and keeping them would leave the
-- table half from a parser that was wrong and half from one that is right,
-- with nothing recording which row came from which.
--
-- ## After this, the register is empty until it reloads
--
-- That is the designed degradation and it is why this is safe to do: an empty
-- register reads `Not searched`, and every report is FORBIDDEN from stating a
-- supply figure rather than free to invent one. The frontier logic then
-- self-heals — with no rows, `frontier=none`, so page 0 asks forward from
-- today and the nightly walk resumes from scratch at three months a page.
--
-- Re-apply `20261214000000` straight after this to reload immediately instead
-- of waiting for 17:45 UTC.
--
-- It reports what it did through `postgres_logs`, because that is the only
-- read-back this deployment's standing restriction admits.

do $$
declare
  before_total  bigint;
  before_kinds  text;
  removed       bigint;
  after_total   bigint;
begin
  select count(*) into before_total from public.market_building_approvals;
  select string_agg(area_kind || '=' || n::text, ', ' order by area_kind)
    into before_kinds
  from (
    select area_kind, count(*) as n
    from public.market_building_approvals group by area_kind
  ) q;

  delete from public.market_building_approvals
  where source_url like '%BA_SA2%';
  get diagnostics removed = row_count;

  select count(*) into after_total from public.market_building_approvals;

  raise warning 'APPROVALS_CLEANUP before=% by_kind=[%] removed=% after=%',
    before_total, before_kinds, removed, after_total;
end $$;
