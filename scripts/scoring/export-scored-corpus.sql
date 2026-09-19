-- Export the scored investment-report corpus for the Scoring V2 shadow replay.
--
-- READ-ONLY. Produces the JSON array consumed by
-- `src/lib/reports/__tests__/corpusReplayV2.spec.ts` (point `V2_REPLAY_CORPUS`
-- at the file). The corpus contains production client data and is deliberately
-- NOT committed; this query is what makes the measurement reproducible.
--
-- Column order below is the `C` map in that spec. Paths are exactly the ones
-- `backtestInput.pure.ts` declares in FIELD_PATHS, so the real resolver runs
-- against the real shapes rather than against a reshaped copy.
--
-- Run once per page: `limit 350 offset 0`, `offset 350`, `offset 700`.
-- `state` is parsed from the free-text address label for the REPORTING
-- breakdown only. It is never used as geography for evidence — the resolver
-- refuses address parsing for that, and `ADDRESS_COMPOSITION.md` records why.

select jsonb_agg(r order by ord) as page from (
  select row_number() over (order by created_at, id) as ord,
    jsonb_build_array(
      id::text,
      left(coalesce(property_address,''),38),
      created_at::date::text,
      coalesce(substring(upper(coalesce(property_address,'')) from '\m(NSW|VIC|QLD|SA|WA|TAS|NT|ACT)\M'),'?'),
      location_intelligence->'coordinates'->'lat',
      location_intelligence->'coordinates'->'lng',
      location_intelligence->'walkScore',
      location_intelligence->'commute'->'durationMinutes',
      location_intelligence->'schools'->'schoolsWithin3km',
      coalesce(property_specs->>'property_type', financial_calculations->'propertySpecs'->>'propertyType'),
      financial_calculations->'initialCosts'->'propertyValue',
      financial_calculations->'initialCosts'->'landPrice',
      financial_calculations->'initialCosts'->'buildPrice',
      financial_calculations->'income'->'weeklyRent',
      coalesce(financial_calculations->'keyMetrics'->'lvr', financial_calculations->'loanDetails'->'lvr'),
      coalesce(financial_calculations->'keyMetrics'->'weeklyNet', financial_calculations->'cashFlow'->'weeklyNet'),
      coalesce(financial_calculations->'annualCosts'->'totalAnnualExcludingLandTax',
               financial_calculations->'annualCosts'->'total'),
      investment_score->'totalScore',
      investment_score->>'grade',
      investment_score->'breakdown'->'growthScore'->'score',   investment_score->'breakdown'->'growthScore'->'hasData',
      investment_score->'breakdown'->'demandScore'->'score',   investment_score->'breakdown'->'demandScore'->'hasData',
      investment_score->'breakdown'->'locationScore'->'score', investment_score->'breakdown'->'locationScore'->'hasData',
      investment_score->'breakdown'->'yieldScore'->'score',    investment_score->'breakdown'->'yieldScore'->'hasData',
      investment_score->'breakdown'->'riskScore'->'score',     investment_score->'breakdown'->'riskScore'->'hasData'
    ) as r
  from investment_reports
  where is_archived = false and investment_score is not null
  order by created_at, id
  limit 350 offset 0
) t;

-- The V1 constant check (Step 5), reproducible on its own:
--
--   select count(*) as reports,
--     count(*) filter (where (investment_score->'breakdown'->'growthScore'->>'score')::numeric = 50) as growth_50,
--     count(*) filter (where (investment_score->'breakdown'->'growthScore'->>'hasData')::bool)       as growth_hasdata,
--     count(*) filter (where (investment_score->'breakdown'->'demandScore'->>'score')::numeric = 50) as demand_50,
--     count(*) filter (where (investment_score->'breakdown'->'demandScore'->>'hasData')::bool)       as demand_hasdata,
--     count(*) filter (where investment_score->'breakdown'->'riskScore'->>'details' ilike '%LVR%')            as risk_cites_lvr,
--     count(*) filter (where investment_score->'breakdown'->'riskScore'->>'details' ilike '%cash flow%')      as risk_cites_cashflow,
--     count(*) filter (where investment_score->'breakdown'->'riskScore'->>'details' ilike '%typically offers%') as risk_type_bonus
--   from investment_reports where is_archived = false and investment_score is not null;
