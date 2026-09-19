-- Export the Trusted Evidence Gate's inputs for the trusted corpus replay.
--
-- READ-ONLY. Produces the JSON array consumed by
-- `src/lib/reports/__tests__/corpusTrustedReplayV2.spec.ts` (point
-- `V2_REPLAY_TRUST` at the file), beside the corpus export from
-- `export-scored-corpus.sql`.
--
-- What it carries, and why each column is here:
--
--   * the geography verdict `resolve-report-geography` already recorded, as a
--     code the spec maps back to the resolver's own vocabulary. The resolver
--     places a coordinate by deterministic point-in-polygon against ABS ASGS
--     2021 boundaries and refuses what it cannot place — of 64 rows carrying
--     the Sydney CBD geocoder failure value, it resolved ZERO. This export
--     reads that verdict; nothing here re-adjudicates it.
--   * the suburb/state/postcode/SA2 it recovered, which the report record
--     itself carries on no row at all.
--   * the operator's entered purchase price and weekly rent, which are the
--     scenario's own authority and, measured across the corpus, disagree with
--     the stored calculation block on zero reports.
--
-- Run once per page: `limit 503 offset 0`, then `offset 503`.

select jsonb_agg(r order by ord) as page from (
  select row_number() over (order by ir.created_at, ir.id) as ord,
    jsonb_build_array(
      ir.id::text,
      case
        when rg.report_id is null then 3                              -- no geography row
        when rg.status = 'resolved' then 0                            -- trusted, ASGS placed
        when 'geocode_failure_value' = any(rg.flags) then 1           -- sentinel coordinate
        when 'corrupted_unrecoverable' = any(rg.flags) then 2         -- not placeable in Australia
        else 4                                                        -- attempted, unresolved
      end,
      rg.suburb, rg.state, rg.postcode, rg.sa2_code, rg.remoteness_area,
      (ir.manual_overrides->>'purchasePrice')::numeric,
      (ir.manual_overrides->>'weeklyRent')::numeric
    ) as r
  from investment_reports ir
  left join report_geography rg on rg.report_id = ir.id
  where ir.is_archived = false and ir.investment_score is not null
  order by ir.created_at, ir.id
  limit 503 offset 0
) t;

-- Supporting measurements quoted in SCORING_INPUT_INTEGRITY_CLOSEOUT.md:
--
-- geography trust distribution:
--   select case when rg.report_id is null then 'no_geography_row'
--               when rg.status='resolved' then 'trusted_asgs_resolved'
--               when 'geocode_failure_value' = any(rg.flags) then 'untrusted_sentinel_coordinate'
--               when 'corrupted_unrecoverable' = any(rg.flags) then 'untrusted_corrupted_address'
--               else 'unresolved_other' end as trust, count(*)
--     from investment_reports ir left join report_geography rg on rg.report_id=ir.id
--    where ir.is_archived=false and ir.investment_score is not null group by 1;
--
-- operator override agreement (0 disagreements on both price and rent):
--   select count(*) filter (where (manual_overrides->>'weeklyRent')::numeric
--                              <> (financial_calculations->'income'->>'weeklyRent')::numeric) as rent_differs,
--          count(*) filter (where (manual_overrides->>'purchasePrice')::numeric
--                              <> (financial_calculations->'initialCosts'->>'propertyValue')::numeric) as price_differs
--     from investment_reports where is_archived=false and investment_score is not null;
--
-- same-property rent contradictions:
--   select left(property_address,40) addr, count(*) reports, count(distinct
--          financial_calculations->'income'->>'weeklyRent') rents, max(created_at::date)-min(created_at::date) span
--     from investment_reports where is_archived=false and investment_score is not null
--      and financial_calculations->'income'->>'weeklyRent' is not null
--    group by 1 having count(*)>1 and count(distinct financial_calculations->'income'->>'weeklyRent')>1;
