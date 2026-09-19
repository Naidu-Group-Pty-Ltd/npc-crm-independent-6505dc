import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { internalError } from '../_shared/errorResponse.ts';
import { parseJsonBody } from '../_shared/validate.ts';
import { LocalityRequest, PUBLIC_SERVICE_MAX_BODY_BYTES } from '../_shared/publicServiceSchemas.ts';
import { sourceUnavailable } from '../_shared/sourceUnavailable.pure.ts';
import { censusEmploymentResponse } from '../_shared/absCensusProjection.pure.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * ABS employment data — honestly: none is integrated yet.
 *
 * What this service used to do, kept on record because every line of it
 * reported as normal operation:
 *
 *  - Its "live" path called `https://api.data.abs.gov.au/data/LF` bare — no
 *    dataflow key, no dimension filter — and its parser read
 *    `observations[0]?.[0] || 62.5`, so even a response that arrived was
 *    reduced to hard-coded numbers.
 *  - On any failure it fell to `generateEmploymentEstimate`: hard-coded
 *    tables for five states (TAS, NT and the ACT silently received NSW's
 *    figures), a labour-force size of `15000 * (0.5 + Math.random() * 0.5)`
 *    — a random number of workers — canned job growth (`+2.8%` annual for
 *    everywhere), a fixed occupation breakdown, and a canned
 *    `futureOutlook: 'Positive'` paragraph for every suburb in the country.
 *  - All of it went out under `dataSource: 'Australian Bureau of Statistics
 *    (ABS)'`, `dataset: '6202.0 - Labour Force, Australia'`, `lastUpdated:
 *    'Latest available data'` — a fabricated figure wearing a national
 *    statistical agency's citation.
 *
 * The rule: **a source that cannot answer says so.** Both report pipelines
 * attach employment data only on `success && data`, so this envelope makes
 * the section absent instead of invented.
 *
 * Real acquisition, when built, is ABS 6202.0 (state headline series) via
 * the SDMX API or the published spreadsheets, and Census G43/G51 by POA for
 * local industry/occupation mix — loaded and verified, per the pattern in
 * `abs-data-service/index.ts`'s header. Until then the answer below is the
 * only honest one this service can give.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

Deno.serve(async (req) => {
  console.log('ABS Employment service invoked');

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // WP-24: bounded and shape-checked. This endpoint takes no session,
    // so a bare req.json() read whatever was sent.
    const __parsed = await parseJsonBody(req, LocalityRequest, corsHeaders, PUBLIC_SERVICE_MAX_BODY_BYTES);
    if (!__parsed.ok) return __parsed.response;
    const { suburb, state, postcode } = __parsed.data;
    console.log('Employment data requested for:', suburb, state, postcode);

    if (!state) {
      return new Response(JSON.stringify({
        success: false,
        error: 'State is required'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Local employment structure from the loaded Census table — real,
    // postcode-level, labelled with its reference period. A postcode the
    // Census does not cover is answered `unavailable`, never given a state
    // average wearing its name.
    const poa = String(postcode ?? '').trim();
    if (/^\d{4}$/.test(poa)) {
      const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
      const { data: row, error } = await supabase
        .from('abs_census_poa')
        .select('*')
        .eq('poa', poa)
        .maybeSingle();
      if (error) {
        console.error('abs_census_poa read failed:', error);
        return new Response(JSON.stringify(sourceUnavailable(
          'abs-employment',
          'provider_error',
          'The ABS Census reference table could not be read — employment figures are unavailable for this request.',
        )), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (row) {
        return new Response(JSON.stringify({
          success: true,
          data: censusEmploymentResponse(row, suburb, state),
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    return new Response(JSON.stringify(sourceUnavailable(
      'abs-employment',
      'no_data_for_location',
      `The ABS Census holds no postal-area data for "${poa || 'no postcode supplied'}" — employment figures are unavailable rather than estimated.`,
    )), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('Error in ABS Employment service:', error);
    return new Response(JSON.stringify({
      ...internalError(error, 'abs-employment-service'),
      success: false,
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
