import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { internalError } from '../_shared/errorResponse.ts';
import { parseJsonBody } from '../_shared/validate.ts';
import { CrimeStatisticsRequest, PUBLIC_SERVICE_MAX_BODY_BYTES } from '../_shared/publicServiceSchemas.ts';
import { sourceUnavailable, type SourceUnavailableReason } from '../_shared/sourceUnavailable.pure.ts';
import { normaliseAuState } from '../_shared/auGeoSanity.pure.ts';
import { normaliseCouncilTokens } from '../_shared/planning/developmentActivity.pure.ts';
import type { CrimeSeriesRow } from '../_shared/crimeIngest.pure.ts';
import {
  nswCrimeReading, ntCrimeReading, qldCrimeReading, saCrimeReading, stateContextFrom,
} from '../_shared/crimeReading.pure.ts';
import {
  ADMISSION_REFUSAL_NOTE,
  admitPopulationForArea,
  type AdmittedPopulation,
} from '../_shared/crimePopulationAdmission.pure.ts';

/**
 * Recorded crime statistics — from the police services' own published
 * registers, loaded into `crime_reference` by `crime-data-ingest`.
 *
 * The fabricated predecessor is recorded in git history (§24): a postcode
 * band scheme that invented offence counts, a `safetyScore` and "22% higher
 * than state average", cached 90 days and served as a hit. The replacement
 * serves COUNTS and their arithmetic, from:
 *
 *  - **NSW** — BOCSAR's recorded criminal incidents by month by POSTCODE
 *    (the request's own geography), all 21 offence categories, with a
 *    per-100k rate whose denominator is named (2021 Census usual residents
 *    of the postal area) and the state benchmark computed at ingest over
 *    the file's own postcodes.
 *  - **QLD** — QPS's reported offences by LOCAL GOVERNMENT AREA. The LGA
 *    arrives from the caller (the generator passes the cadastre's own
 *    shire name once planning resolved it) and is matched to the register's
 *    naming by the same normalised-token rule the DA lookup uses — refusal
 *    over guessing, `Canterbury-Bankstown` can never match `Bankstown`.
 *
 * Any other state answers `no_data_for_location` naming its real register
 * (VIC's CSA refuses scripted clients — the DFAT class — and the rest are
 * unprobed), because a state without a loaded register has no figures, not
 * borrowed ones. No score, no rating, no adjective: a test bans the old
 * vocabulary from ever returning.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const unavailable = (reason: SourceUnavailableReason, message: string) =>
  json(sourceUnavailable('crime-statistics', reason, message));

Deno.serve(async (req) => {
  console.log('Crime Statistics service invoked');

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const __parsed = await parseJsonBody(req, CrimeStatisticsRequest, corsHeaders, PUBLIC_SERVICE_MAX_BODY_BYTES);
    if (!__parsed.ok) return __parsed.response;
    const { suburb, state, postcode, lga } = __parsed.data;
    // RF-7.2B.1B0-F4 — the denominator arrives as ADMITTED EVIDENCE or not at
    // all. This service used to look `abs_census_poa.population` up itself, on
    // whatever postcode it was handed; when the report's geography was
    // unresolved that was the untrusted postcode scraped from the address, and
    // it restored a population the Client-Safe Gate had withheld. Nothing here
    // reads a population table any more.
    const population = (__parsed.data as { population?: AdmittedPopulation }).population ?? null;
    console.log('Crime statistics requested for:', { suburb, state, postcode, lga });

    const stateCode = normaliseAuState(state);
    if (!stateCode) {
      return json({ success: false, error: 'Unrecognised state' }, 400);
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const rowsFor = async (st: 'NSW' | 'QLD' | 'SA' | 'NT', kind: string, area?: string) => {
      let q = supabase.from('crime_reference')
        .select('area, offence, months12, prior12, year_totals, latest_month, series_from, source, series_note')
        .eq('state', st).eq('area_kind', kind);
      if (area) q = q.eq('area', area);
      const { data, error } = await q;
      if (error) throw new Error(`crime_reference read failed: ${error.message}`);
      return (data ?? []).map((r) => ({
        area: r.area,
        offence: r.offence,
        months12: r.months12,
        // Nullable on purpose: SAPOL's July 2025 reclassification means its
        // Level 2 categories have no like-for-like prior year, and the row
        // says so rather than carrying a number computed across it.
        prior12: r.prior12 as number | null,
        yearTotals: r.year_totals as Record<string, number>,
        latestMonth: r.latest_month,
        seriesFrom: r.series_from,
        source: r.source as string,
        seriesNote: (r.series_note as string | null) ?? null,
      }));
    };

    /** The state benchmark row, or nulls. Shared by the two postcode-keyed registers. */
    const benchmarkFor = async (st: 'NSW' | 'SA') => {
      const { data } = await supabase.from('crime_state_benchmarks')
        .select('total12, population, rate_per_100k, denominator').eq('state', st).maybeSingle();
      return data ?? null;
    };

    if (stateCode === 'NSW') {
      const poa = String(postcode ?? '').trim();
      if (!/^\d{4}$/.test(poa)) {
        return unavailable('no_data_for_location',
          'The NSW register is postcode-keyed and no four-digit postcode was supplied — crime figures are unavailable rather than approximated.');
      }
      const rows = await rowsFor('NSW', 'postcode', poa);
      if (rows.length === 0) {
        return unavailable('no_data_for_location',
          `The BOCSAR postcode dataset holds no rows for ${poa} — recorded-crime figures are unavailable for this postal area rather than borrowed from a neighbour.`);
      }
      const stateRows = await rowsFor('NSW', 'state_total');
      const { data: bench } = await supabase.from('crime_state_benchmarks')
        .select('total12, population, rate_per_100k, denominator').eq('state', 'NSW').maybeSingle();
      const admission = admitPopulationForArea(population, 'postcode', poa);
      if (admission.refusedBecause) {
        console.log(`[crime] NSW ${poa}: no per-capita rate — `
          + ADMISSION_REFUSAL_NOTE[admission.refusedBecause]);
      }
      const reading = nswCrimeReading(
        rows as CrimeSeriesRow[],
        poa,
        rows[0].source,
        {
          area: admission.value,
          state: (bench?.population as number | null) ?? null,
          vintage: admission.admitted
            ? `${admission.admitted.vintage} (${admission.admitted.source}, ${admission.admitted.geography}); `
              + 'the state rate uses '
              + ((bench?.denominator as string | null) ?? 'no stated denominator')
            : 'no admitted area population; the state rate uses '
              + ((bench?.denominator as string | null) ?? 'no stated denominator'),
        },
        (bench?.total12 as number | null) ?? null,
        stateContextFrom(stateRows as CrimeSeriesRow[], 'NSW'),
      );
      if (!reading) {
        return unavailable('no_data_for_location', `No composable crime reading for postcode ${poa}.`);
      }
      return json({ success: true, data: reading });
    }

    if (stateCode === 'QLD') {
      const wanted = String(lga ?? '').trim();
      if (wanted === '') {
        return unavailable('no_data_for_location',
          'The QLD register is keyed by local government area and none was supplied — figures are unavailable rather than guessed from a suburb name. The generator passes the cadastre’s shire name once planning data has resolved it.');
      }
      // One indexed lookup on the token written at ingest — the register is
      // 7,176 LGA rows, and fetching them all to match in code is how the
      // PostgREST max-rows cap silently truncates (the §25 lesson).
      const want = normaliseCouncilTokens(wanted);
      const { data: matched, error: matchError } = await supabase
        .from('crime_reference')
        .select('area, offence, months12, prior12, year_totals, latest_month, series_from, source')
        .eq('state', 'QLD').eq('area_kind', 'lga').eq('area_token', want);
      if (matchError) throw new Error(`crime_reference read failed: ${matchError.message}`);
      const rows = (matched ?? []).map((r) => ({
        area: r.area, offence: r.offence, months12: r.months12, prior12: r.prior12,
        yearTotals: r.year_totals as Record<string, number>,
        latestMonth: r.latest_month, seriesFrom: r.series_from, source: r.source as string,
      }));
      const areas = [...new Set(rows.map((r) => r.area))];
      if (areas.length !== 1) {
        return unavailable('no_data_for_location',
          `The QPS register names no single local government area matching "${wanted}" (${areas.length} candidates) — refusing rather than reporting another council's offences.`);
      }
      const stateRows = await rowsFor('QLD', 'state_total');
      const reading = qldCrimeReading(
        rows as CrimeSeriesRow[],
        areas[0],
        rows[0].source,
        stateContextFrom(stateRows as CrimeSeriesRow[], 'QLD'),
      );
      if (!reading) {
        return unavailable('no_data_for_location', `No composable crime reading for ${areas[0]}.`);
      }
      return json({ success: true, data: reading });
    }

    // -----------------------------------------------------------------
    // SA — SAPOL, postcode-keyed (the platform's own geography)
    // -----------------------------------------------------------------
    if (stateCode === 'SA') {
      const poa = String(postcode ?? '').trim();
      if (!/^\d{1,4}$/.test(poa)) {
        return unavailable('no_data_for_location',
          'The SA register is postcode-keyed and no postcode was supplied — crime figures are unavailable rather than approximated.');
      }
      // The register stores four-digit postcodes; SAPOL's own export drops the
      // leading zero of 0872 in one path and keeps it in another, so a caller
      // sending either spelling resolves to the one stored key.
      const area = poa.padStart(4, '0');
      const rows = await rowsFor('SA', 'postcode', area);
      if (rows.length === 0) {
        return unavailable('no_data_for_location',
          `The SAPOL crime-statistics dataset holds no rows for postcode ${area} — recorded-crime figures are unavailable for this postal area rather than borrowed from a neighbour.`);
      }
      const stateRows = await rowsFor('SA', 'state_total');
      const bench = await benchmarkFor('SA');
      const saAdmission = admitPopulationForArea(population, 'postcode', area);
      if (saAdmission.refusedBecause) {
        console.log(`[crime] SA ${area}: no per-capita rate — `
          + ADMISSION_REFUSAL_NOTE[saAdmission.refusedBecause]);
      }
      const reading = saCrimeReading(
        rows, area, rows[0].source,
        {
          area: saAdmission.value,
          state: (bench?.population as number | null) ?? null,
          vintage: saAdmission.admitted
            ? `${saAdmission.admitted.vintage} (${saAdmission.admitted.source}, `
              + `${saAdmission.admitted.geography}); the state rate uses `
              + ((bench?.denominator as string | null) ?? 'no stated denominator')
            : 'no admitted area population; the state rate uses '
              + ((bench?.denominator as string | null) ?? 'no stated denominator'),
        },
        (bench?.total12 as number | null) ?? null,
        stateContextFrom(stateRows, 'SA'),
      );
      if (!reading) {
        return unavailable('no_data_for_location', `No composable crime reading for postcode ${area}.`);
      }
      return json({ success: true, data: reading });
    }

    // -----------------------------------------------------------------
    // NT — reporting region (the register publishes no postcode at all)
    // -----------------------------------------------------------------
    if (stateCode === 'NT') {
      // Darwin, Palmerston, Alice Springs, Katherine, Tennant Creek and
      // Nhulunbuy are the register's own regions, so an LGA or locality name
      // resolves through the same normalised-token rule the QLD lookup uses.
      // Everything else in the Territory is `NT Balance`, which this will not
      // silently substitute: a property outside the six is answered honestly
      // rather than given the whole Territory's remainder as if it were local.
      const candidates = [lga, suburb].map((v) => String(v ?? '').trim()).filter((v) => v !== '');
      if (candidates.length === 0) {
        return unavailable('no_data_for_location',
          'The NT register is keyed by reporting region (Darwin, Palmerston, Alice Springs, Katherine, Tennant Creek, Nhulunbuy) and neither a locality nor an LGA was supplied — figures are unavailable rather than guessed.');
      }
      const tokens = candidates.map((c) => normaliseCouncilTokens(c)).filter((t) => t !== '');
      const { data, error } = await supabase.from('crime_reference')
        .select('area, area_token').eq('state', 'NT').eq('area_kind', 'region').in('area_token', tokens);
      if (error) throw new Error(`crime_reference read failed: ${error.message}`);
      const areas = [...new Set((data ?? []).map((r) => r.area as string))];
      if (areas.length !== 1) {
        return unavailable('no_data_for_location',
          `The NT register publishes recorded offences by reporting region, and "${candidates[0]}" is not one of them. ` +
          'Figures are unavailable for this locality rather than taken from the Territory-wide remainder.');
      }
      const rows = await rowsFor('NT', 'region', areas[0]);
      const stateRows = await rowsFor('NT', 'state_total');
      const reading = ntCrimeReading(rows, areas[0], 'reporting region', rows[0]?.source ?? '',
        stateContextFrom(stateRows, 'NT'));
      if (!reading) {
        return unavailable('no_data_for_location', `No composable crime reading for ${areas[0]}.`);
      }
      return json({ success: true, data: reading });
    }

    return unavailable('no_data_for_location',
      `No recorded-crime register is loaded for ${stateCode}. NSW (BOCSAR), QLD (QPS), SA (SAPOL) and NT (NT Police) are integrated; VIC's Crime Statistics Agency refuses scripted clients and WA, TAS and ACT are not yet verified — figures for ${stateCode} are unavailable rather than estimated.`);
  } catch (error: unknown) {
    console.error('Error in Crime Statistics service:', error);
    return json({ ...internalError(error, 'crime-statistics-service'), success: false }, 500);
  }
});
