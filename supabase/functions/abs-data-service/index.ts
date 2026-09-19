import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse } from '../_shared/auth.ts';

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { sourceUnavailable } from "../_shared/sourceUnavailable.pure.ts";
import { internalError } from '../_shared/errorResponse.ts';
import { censusDemographicsResponse } from '../_shared/absCensusProjection.pure.ts';

/**
 * ABS demographic data — or, honestly, the absence of it.
 *
 * This service used to be the single worst fabricator in the platform, and
 * the record of what it did is kept here because the temptation it fell to
 * is permanent. It **never called the ABS**: four live-API functions
 * (`fetchPopulationData`, `fetchIncomeData`, `fetchHousingData`,
 * `fetchEmploymentData`) sat in this file with no caller, while every
 * request was answered by `getPostcodeProfile` — one of THREE invented
 * demographic profiles for the whole of Australia (eleven postcodes were
 * "high-income metro", NT/TAS/SA were "regional", everywhere else
 * "standard suburban"), with `Math.random()` jitter on population, density,
 * income, age and rent so the fiction never even repeated itself. Each
 * answer was labelled `source: 'ABS Census 2021 estimates'`, cached for 30
 * days, and served back on the next request as `'ABS Census Cache'` — the
 * fabrication laundering itself into a cache hit — while `api_health_log`
 * recorded a successful call to `'abs-census'` that was never made.
 *
 * Measured in production on 2026-09-06, before removal:
 *  - **849 of 1,199 stored reports, across 500 distinct properties, carried
 *    the identical profile**: growth 2.5%, unemployment 3.5%,
 *    owner-occupiers 69.8%, participation 68.4%.
 *  - `10 Chester Street` held **20 reports with 20 different populations**,
 *    16,245 to 38,773; median income $99,003 to $141,343.
 *  - `abs_census_cache` held 123 rows; **not one was live**.
 *
 * The rule now: **a source that cannot answer says so.** A report without a
 * demographics section is a visible absence a reader can weigh; a report
 * with an invented one is a defect nobody can detect, because every figure
 * is plausible and every figure is wrong.
 *
 * What real acquisition looks like (recorded so "unavailable" has a
 * remedy): the ABS publishes 2021 Census GCP DataPacks by postal area (POA)
 * under CC BY 4.0 — G01 (counts) and G02 (medians) carry exactly the
 * fields this service promises. The platform's own precedent is the
 * sanctions register: load the published file into a table on a schedule,
 * read locally at request time, and let freshness be a property of the
 * file's own dates. The live SDMX API (api.data.abs.gov.au) is the
 * alternative; it could not be verified from this environment, and an
 * unverified parser of a statistical agency's API is how the last version
 * of this file started. Until one of those is built and verified, the
 * cache read below only ever serves rows marked `live` — which is to say,
 * rows a real integration wrote — and otherwise this service answers
 * `unavailable`.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);

  console.log('📊 ABS data service invoked');

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // SECURITY: Verify authentication
    const body = await req.json();
    const { postcode, state } = body;

    const { error: authError, userId } = await verifyAuth(supabase, req.headers, body);
    if (authError) {
      console.log('[abs-data-service] Auth failed:', authError);
      return createUnauthorizedResponse(authError, corsHeaders);
    }
    console.log(`[abs-data-service] Authenticated user: ${userId}`);
    console.log('Fetching ABS data for:', { postcode, state });

    // The real thing: the ABS's own Census figures for this postal area,
    // loaded from the published DataPack by `abs-poa-ingest` and projected
    // through one shared module. No profile, no Math.random(), no
    // "estimate" — a postcode the Census does not cover is answered
    // `unavailable`, never approximated from a neighbour.
    const poa = String(postcode ?? '').trim();
    if (/^\d{4}$/.test(poa)) {
      const { data: row, error } = await supabase
        .from('abs_census_poa')
        .select('*')
        .eq('poa', poa)
        .maybeSingle();
      if (error) {
        console.error('abs_census_poa read failed:', error);
        return new Response(JSON.stringify(sourceUnavailable(
          'abs-demographics',
          'provider_error',
          'The ABS Census reference table could not be read — demographic figures are unavailable for this request.',
        )), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (row) {
        return new Response(JSON.stringify({
          success: true,
          data: censusDemographicsResponse(row),
        }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    return new Response(JSON.stringify(sourceUnavailable(
      'abs-demographics',
      'no_data_for_location',
      `The ABS Census holds no postal-area data for "${poa || 'no postcode supplied'}" — demographic figures are unavailable rather than estimated.`,
    )), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('❌ Error in ABS data service:', error);
    return new Response(JSON.stringify({
      ...internalError(error, 'abs-data-service'),
      success: false
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
