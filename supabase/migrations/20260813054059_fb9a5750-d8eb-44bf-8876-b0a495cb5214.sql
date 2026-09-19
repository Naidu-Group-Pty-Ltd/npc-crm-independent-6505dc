ALTER TABLE public.stamp_duty_rates_cache
  ADD COLUMN IF NOT EXISTS schedule jsonb,
  ADD COLUMN IF NOT EXISTS verified_on date,
  ADD COLUMN IF NOT EXISTS last_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS verification_note text,
  ADD COLUMN IF NOT EXISTS verification_flagged boolean NOT NULL DEFAULT false;

ALTER TABLE public.stamp_duty_rates_cache
  ALTER COLUMN brackets DROP NOT NULL;

COMMENT ON COLUMN public.stamp_duty_rates_cache.brackets IS
  'Deprecated. Superseded by "schedule", which can express flat bands, formula bands, owner-occupier and premium scales, and concessions. Retained only so older deployments do not fail on a NOT NULL.';
COMMENT ON COLUMN public.stamp_duty_rates_cache.schedule IS
  'Full DutySchedule as defined in supabase/functions/_shared/stampDuty/types.pure.ts. Validated on read; a row that fails validation is ignored in favour of the built-in schedule.';
COMMENT ON COLUMN public.stamp_duty_rates_cache.data_quality IS
  'built_in | override | needs_review. Only built_in and override are served.';

UPDATE public.stamp_duty_rates_cache
   SET data_quality = 'built_in'
 WHERE data_quality IN ('fallback', 'live');

ALTER TABLE public.stamp_duty_rates_cache
  DROP CONSTRAINT IF EXISTS stamp_duty_rates_cache_data_quality_check;
ALTER TABLE public.stamp_duty_rates_cache
  ADD CONSTRAINT stamp_duty_rates_cache_data_quality_check
  CHECK (data_quality IN ('built_in', 'override', 'needs_review'));

INSERT INTO public.stamp_duty_rates_cache (state, schedule, data_quality, source_url, verified_on) VALUES
  ('NSW', '{"state":"NSW","year":"2026-27","effectiveFrom":"2026-07-01","indexedAnnually":true,"sourceUrl":"https://www.revenue.nsw.gov.au/taxes-duties-levies-royalties/transfer-duty/rates","general":[{"from":0,"base":0,"rate":1.25,"min":20},{"from":18000,"base":225,"rate":1.5},{"from":38000,"base":525,"rate":1.75},{"from":103000,"base":1662,"rate":3.5},{"from":387000,"base":11602,"rate":4.5},{"from":1290000,"base":52237,"rate":5.5}],"premium":{"from":3870000,"bands":[{"from":3870000,"base":194137,"rate":7}]},"firstHome":{"established":{"kind":"exempt_to_taper","fullTo":800000,"taperTo":1000000},"newHome":{"kind":"exempt_to_taper","fullTo":800000,"taperTo":1000000},"vacantLand":{"kind":"exempt_to_taper","fullTo":350000,"taperTo":450000}},"foreignSurchargePct":9,"notes":["Premium property duty applies to residential land only; non-residential land above the premium threshold stays on the general scale.","First Home Buyers Assistance Scheme thresholds have been $800k/$1m (homes) and $350k/$450k (land) since 1 July 2023 and are not indexed."]}'::jsonb, 'built_in', 'https://www.revenue.nsw.gov.au/taxes-duties-levies-royalties/transfer-duty/rates', '2026-08-10'::date),
  ('VIC', '{"state":"VIC","year":"2026-27","effectiveFrom":"2021-07-01","indexedAnnually":false,"sourceUrl":"https://www.sro.vic.gov.au/about-us/rates-and-statistics/current-rates/land-transfer-duty-non-principal-place-residence-current-rates","general":[{"from":0,"base":0,"rate":1.4},{"from":25000,"base":350,"rate":2.4},{"from":130000,"base":2870,"rate":6},{"from":960000,"mode":"flat","rate":5.5},{"from":2000000,"base":110000,"rate":6.5}],"ownerOccupier":[{"from":0,"base":0,"rate":1.4},{"from":25000,"base":350,"rate":2.4},{"from":130000,"base":2870,"rate":5},{"from":440000,"base":18370,"rate":6}],"ownerOccupierUpTo":550000,"firstHome":{"established":{"kind":"exempt_to_taper","fullTo":600000,"taperTo":750000},"newHome":{"kind":"exempt_to_taper","fullTo":600000,"taperTo":750000},"vacantLand":{"kind":"exempt_to_taper","fullTo":600000,"taperTo":750000}},"foreignSurchargePct":8,"notes":["The $960k–$2m band is a flat 5.5% of the whole dutiable value, not a marginal rate.","PPR concessional rates are unavailable above $550,000; general rates then apply to the full value."]}'::jsonb, 'built_in', 'https://www.sro.vic.gov.au/about-us/rates-and-statistics/current-rates/land-transfer-duty-non-principal-place-residence-current-rates', '2026-08-10'::date),
  ('QLD', '{"state":"QLD","year":"2026-27","effectiveFrom":"2025-05-01","indexedAnnually":false,"sourceUrl":"https://qro.qld.gov.au/duties/transfer-duty/calculate/rates/","general":[{"from":0,"base":0,"rate":0},{"from":5000,"base":0,"rate":1.5},{"from":75000,"base":1050,"rate":3.5},{"from":540000,"base":17325,"rate":4.5},{"from":1000000,"base":38025,"rate":5.75}],"ownerOccupier":[{"from":0,"base":0,"rate":1},{"from":350000,"base":3500,"rate":3.5},{"from":540000,"base":10150,"rate":4.5},{"from":1000000,"base":30850,"rate":5.75}],"firstHome":{"established":{"kind":"fixed_steps","steps":[{"under":710000,"amount":17350},{"under":720000,"amount":15615},{"under":730000,"amount":13880},{"under":740000,"amount":12145},{"under":750000,"amount":10410},{"under":760000,"amount":8675},{"under":770000,"amount":6940},{"under":780000,"amount":5205},{"under":790000,"amount":3470},{"under":800000,"amount":1735}]},"newHome":{"kind":"exempt_all","note":"Full first home (new home) concession, no value cap, contracts from 1 May 2025."},"vacantLand":{"kind":"exempt_all","note":"Full first home vacant land concession, no value cap, contracts from 1 May 2025."}},"foreignSurchargePct":8,"notes":["The home concession scale applies to any buyer occupying the property, not only first home buyers.","The first home concession is a fixed dollar deduction from home-concession duty, stepping down $1,735 per $10,000 of value to nil at $800,000."]}'::jsonb, 'built_in', 'https://qro.qld.gov.au/duties/transfer-duty/calculate/rates/', '2026-08-10'::date),
  ('WA', '{"state":"WA","year":"2026-27","effectiveFrom":"2026-05-07","indexedAnnually":false,"sourceUrl":"https://www.wa.gov.au/organisation/department-of-treasury-and-finance/transfer-duty-assessment","general":[{"from":0,"base":0,"rate":1.9},{"from":120000,"base":2280,"rate":2.85},{"from":150000,"base":3135,"rate":3.8},{"from":360000,"base":11115,"rate":4.75},{"from":725000,"base":28453,"rate":5.15}],"ownerOccupier":[{"from":0,"base":0,"rate":1.5},{"from":120000,"base":1800,"rate":4.04}],"ownerOccupierUpTo":200000,"firstHome":{"established":{"kind":"scale","appliesUpTo":800000,"bands":[{"from":0,"base":0,"rate":0},{"from":600000,"base":0,"rate":16.15}]},"newHome":{"kind":"scale","appliesUpTo":800000,"bands":[{"from":0,"base":0,"rate":0},{"from":600000,"base":0,"rate":16.15}]},"vacantLand":{"kind":"scale","appliesUpTo":550000,"bands":[{"from":0,"base":0,"rate":0},{"from":450000,"base":0,"rate":20.14}]}},"foreignSurchargePct":7,"notes":["First home owner rate from 7 May 2026: nil to $600,000 for homes and nil to $450,000 for vacant land, statewide (no metropolitan/regional split).","WA''s concessional rate covers a principal residence only up to $200,000 and so rarely bites in practice."]}'::jsonb, 'built_in', 'https://www.wa.gov.au/organisation/department-of-treasury-and-finance/transfer-duty-assessment', '2026-08-10'::date),
  ('SA', '{"state":"SA","year":"2026-27","effectiveFrom":"2025-02-13","indexedAnnually":false,"sourceUrl":"https://www.revenuesa.sa.gov.au/stamp-duty-land/rate-of-stamp-duty","general":[{"from":0,"base":0,"rate":1},{"from":12000,"base":120,"rate":2},{"from":30000,"base":480,"rate":3},{"from":50000,"base":1080,"rate":3.5},{"from":100000,"base":2830,"rate":4},{"from":200000,"base":6830,"rate":4.25},{"from":250000,"base":8955,"rate":4.75},{"from":300000,"base":11330,"rate":5},{"from":500000,"base":21330,"rate":5.5}],"firstHome":{"established":{"kind":"none","note":"SA first home relief covers new homes and land to build on only; an established home pays full duty."},"newHome":{"kind":"exempt_all","note":"Full exemption with no value cap for eligible new homes, contracts from 13 February 2025."},"vacantLand":{"kind":"exempt_all","note":"Full exemption with no value cap for vacant land on which a new home will be built."}},"foreignSurchargePct":7,"notes":["RevenueSA blocks automated retrieval; the band table was confirmed against RevenueSA quoted figures ($8,955 / $11,330 / $21,330 at the $250k / $300k / $500k boundaries) and cross-checked band by band for continuity.","Commercial and industrial property has been exempt from SA conveyance duty since 1 July 2018 — this schedule covers residential only."]}'::jsonb, 'built_in', 'https://www.revenuesa.sa.gov.au/stamp-duty-land/rate-of-stamp-duty', '2026-08-10'::date),
  ('TAS', '{"state":"TAS","year":"2026-27","effectiveFrom":"2026-07-01","indexedAnnually":false,"sourceUrl":"https://www.sro.tas.gov.au/property-transfer-duties/rates-of-duty","general":[{"from":0,"base":50,"rate":0},{"from":3000,"base":50,"rate":1.75},{"from":25000,"base":435,"rate":2.25},{"from":75000,"base":1560,"rate":3.5},{"from":200000,"base":5935,"rate":4},{"from":375000,"base":12935,"rate":4.25},{"from":725000,"base":27810,"rate":4.5}],"firstHome":{"established":{"kind":"none","note":"The 100% first home exemption to $750,000 expired 30 June 2026; established homes now pay full duty."},"newHome":{"kind":"none","note":"The 100% first home exemption to $750,000 expired 30 June 2026."},"vacantLand":{"kind":"none","note":"No first home vacant land duty concession currently in force."}},"foreignSurchargePct":8,"notes":["Duty on a property worth $3,000 or less is a flat $50.","The first home exemption that ran 18 February 2024 – 30 June 2026 has ended; do not reinstate it without a fresh SRO reference."]}'::jsonb, 'built_in', 'https://www.sro.tas.gov.au/property-transfer-duties/rates-of-duty', '2026-08-10'::date),
  ('NT', '{"state":"NT","year":"2026-27","effectiveFrom":"2024-07-01","indexedAnnually":false,"sourceUrl":"https://nt.gov.au/property/land-title-and-valuation/stamp-duty","general":[{"from":0,"mode":"nt_quadratic"},{"from":525000,"mode":"flat","rate":4.95},{"from":3000000,"mode":"flat","rate":5.75},{"from":5000000,"mode":"flat","rate":5.95}],"firstHome":{"established":{"kind":"none","note":"The NT First Home Owner Discount ended 30 June 2021; relief is delivered as cash grants, not duty concessions."},"newHome":{"kind":"none","note":"The NT First Home Owner Discount ended 30 June 2021; relief is delivered as cash grants, not duty concessions."},"vacantLand":{"kind":"none","note":"The NT First Home Owner Discount ended 30 June 2021."}},"foreignSurchargePct":0,"notes":["Below $525,000 duty is D = (0.06571441 × V²) + 15V where V is the dutiable value in thousands.","Above $525,000 the rate applies to the entire dutiable value, not the excess.","The Northern Territory is the only jurisdiction with no foreign purchaser surcharge.","NT first home grants (FHOG and the HomeGrown Territory grants) are cash payments and are deliberately not netted off duty here."]}'::jsonb, 'built_in', 'https://nt.gov.au/property/land-title-and-valuation/stamp-duty', '2026-08-10'::date),
  ('ACT', '{"state":"ACT","year":"2026-27","effectiveFrom":"2026-07-01","indexedAnnually":true,"sourceUrl":"https://www.revenue.act.gov.au/duties/conveyance-duty","general":[{"from":0,"base":0,"rate":1.2},{"from":200000,"base":2400,"rate":2.2},{"from":300000,"base":4600,"rate":3.4},{"from":500000,"base":11400,"rate":4.32},{"from":750000,"base":22200,"rate":5.9},{"from":1000000,"base":36950,"rate":6.4},{"from":1455000,"mode":"flat","rate":4.54}],"ownerOccupier":[{"from":0,"base":0,"rate":0.28},{"from":260000,"base":728,"rate":2.2},{"from":300000,"base":1608,"rate":3.4},{"from":500000,"base":8408,"rate":4.32},{"from":750000,"base":19208,"rate":5.9},{"from":1000000,"base":33958,"rate":6.4},{"from":1455000,"mode":"flat","rate":4.54}],"firstHome":{"established":{"kind":"exempt_all","note":"Home Buyer Concession Scheme: full exemption, no income test or value cap, from 1 July 2026."},"newHome":{"kind":"exempt_all","note":"Home Buyer Concession Scheme: full exemption, no income test or value cap, from 1 July 2026."},"vacantLand":{"kind":"exempt_all","note":"Home Buyer Concession Scheme: full exemption, no income test or value cap, from 1 July 2026."}},"foreignSurchargePct":0,"notes":["The ACT Revenue Office blocks automated retrieval; both schedules were confirmed against two independent published reproductions that agreed exactly, and every band boundary was checked for continuity.","The flat 4.54% band above $1,455,000 is calibrated to the investor scale, so owner-occupier duty is discontinuous there by design.","The ACT levies no foreign purchaser duty surcharge; it applies a land tax surcharge instead, which is annual rather than at acquisition."]}'::jsonb, 'built_in', 'https://www.revenue.act.gov.au/duties/conveyance-duty', '2026-08-10'::date)
ON CONFLICT (state) DO UPDATE SET
  schedule = EXCLUDED.schedule,
  data_quality = EXCLUDED.data_quality,
  source_url = EXCLUDED.source_url,
  verified_on = EXCLUDED.verified_on,
  brackets = NULL,
  verification_flagged = false,
  verification_note = NULL,
  expires_at = NOW() + INTERVAL '400 days',
  updated_at = NOW();

CREATE OR REPLACE FUNCTION public.cleanup_expired_stamp_duty_cache()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  UPDATE public.stamp_duty_rates_cache
     SET data_quality = 'needs_review',
         verification_flagged = true,
         verification_note = 'Override expired; reverted to the schedule shipped in code pending review.'
   WHERE expires_at < NOW()
     AND data_quality = 'override';
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('verify-stamp-duty-schedules-weekly')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'verify-stamp-duty-schedules-weekly');

    PERFORM cron.schedule(
      'verify-stamp-duty-schedules-weekly',
      '17 19 * * 1',
      $job$SELECT public.cron_invoke_signed_function('update-stamp-duty-rates', '{}'::jsonb, 'pg_cron');$job$
    );
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('expire-stamp-duty-overrides-weekly')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'expire-stamp-duty-overrides-weekly');

    PERFORM cron.schedule(
      'expire-stamp-duty-overrides-weekly',
      '17 18 * * 1',
      $job$SELECT public.cleanup_expired_stamp_duty_cache();$job$
    );
  END IF;
END;
$$;