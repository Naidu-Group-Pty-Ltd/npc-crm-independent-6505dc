import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { internalError } from '../_shared/errorResponse.ts';
import { parseJsonBody } from '../_shared/validate.ts';
import { ClimateDataRequest, PUBLIC_SERVICE_MAX_BODY_BYTES } from '../_shared/publicServiceSchemas.ts';
import { sourceUnavailable } from '../_shared/sourceUnavailable.pure.ts';
import { assessAuPoint } from '../_shared/auGeoSanity.pure.ts';
import {
  buildSiloMonthlyUrl, computeClimateReading, parseSiloMonthly,
} from '../_shared/climateReading.pure.ts';

/**
 * Climate reading — from SILO's Data Drill at the property's coordinate.
 *
 * What this replaced, kept on record (§24): `generateClimateEstimate`, a
 * hard-coded per-state table — every property in NSW shared one annual
 * rainfall (1,150 mm) from Bourke to Bondi — cached for 365 days
 * (`climate_data_cache` held 1,237 rows at removal, not one live) while
 * `api_health_log` recorded a success for a fetch that never happened.
 *
 * The real thing: the Queensland Government's SILO Data Drill serves
 * BoM-derived monthly values interpolated onto a ~5 km grid, CC BY 4.0
 * with the licence stated in the response. One request covers 1991 → the
 * last complete month; `_shared/climateReading.pure.ts` (under vitest, and
 * executed against the live service for three coordinates before this
 * shipped) computes the 1991–2020 normals and a like-for-like recent
 * window, refusing implausible values and incomplete normals.
 *
 * Rules:
 *  - the COORDINATE is the question — a request without one answers
 *    `no_data_for_location` honestly (the §24 posture), never a state-wide
 *    constant; `assessAuPoint` gates what arrives;
 *  - readings cache per ~5 km grid cell (`climate_normals_cache`, 30-day
 *    TTL) and a transport failure is never cached;
 *  - the reading names its windows and its basis (interpolated grid, not a
 *    station record) and carries the SILO/BoM attribution its licence asks
 *    for.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

const CACHE_TTL_HOURS = 30 * 24;
const FETCH_TIMEOUT_MS = 25_000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

/** Last day of the previous month, so no partial month leaks into windows. */
function lastCompleteMonthEnd(now = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  return d.toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const __parsed = await parseJsonBody(req, ClimateDataRequest, corsHeaders, PUBLIC_SERVICE_MAX_BODY_BYTES);
    if (!__parsed.ok) return __parsed.response;
    const { suburb, state, postcode, latitude, longitude } = __parsed.data;
    console.log(`🌡️ Climate data request:`, { suburb, state, postcode, latitude, longitude });

    if (latitude === undefined || longitude === undefined) {
      return json(sourceUnavailable(
        'climate-data',
        'no_data_for_location',
        'Climate is read from SILO at the property coordinate, and this request carried none — figures are unavailable rather than served as a state-wide constant. The generator passes the verified coordinate once location intelligence has resolved it.',
      ));
    }

    const verdict = assessAuPoint(latitude, longitude, state ?? null);
    if (!verdict.ok) {
      return json(sourceUnavailable(
        'climate-data',
        'no_data_for_location',
        `The coordinate fails the Australia gate (${verdict.reason}) — climate is unavailable rather than read from the wrong place.`,
      ));
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // One ~5 km grid cell, one cache entry.
    const cellLat = Math.round(latitude * 20) / 20;
    const cellLng = Math.round(longitude * 20) / 20;
    const cacheKey = `${cellLat.toFixed(2)},${cellLng.toFixed(2)}`;
    const cutoff = new Date(Date.now() - CACHE_TTL_HOURS * 3600 * 1000).toISOString();
    const { data: cached } = await supabase
      .from('climate_normals_cache')
      .select('data')
      .eq('cache_key', cacheKey)
      .eq('data_quality', 'live')
      .gte('fetched_at', cutoff)
      .maybeSingle();
    if (cached?.data) {
      console.log('🌡️ cache hit', { cacheKey });
      return json({ success: true, data: cached.data, cached: true });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let text: string;
    try {
      const res = await fetch(buildSiloMonthlyUrl(cellLat, cellLng, lastCompleteMonthEnd()), {
        headers: { 'User-Agent': 'npc-property-dashboard-climate' },
        signal: controller.signal,
      });
      if (!res.ok) {
        return json(sourceUnavailable(
          'climate-data',
          'provider_error',
          `SILO answered ${res.status} — climate figures are unavailable for this request rather than substituted.`,
        ));
      }
      text = await res.text();
    } catch (fetchError) {
      console.error('SILO fetch failed:', fetchError);
      return json(sourceUnavailable(
        'climate-data',
        'provider_error',
        'SILO could not be reached — climate figures are unavailable for this request rather than substituted.',
      ));
    } finally {
      clearTimeout(timer);
    }

    // A drifted or truncated response REFUSES inside the parser; that is a
    // provider fault, answered unavailable and never cached.
    let reading;
    try {
      reading = computeClimateReading(parseSiloMonthly(text));
    } catch (parseError) {
      console.error('SILO response refused:', parseError);
      return json(sourceUnavailable(
        'climate-data',
        'provider_error',
        'SILO answered in a shape the parser refuses (drifted or truncated) — climate figures are unavailable rather than guessed.',
      ));
    }

    const data = { ...reading, gridCell: { latitude: cellLat, longitude: cellLng } };
    const { error: cacheError } = await supabase.from('climate_normals_cache').upsert({
      cache_key: cacheKey,
      latitude: cellLat,
      longitude: cellLng,
      data,
      data_quality: 'live',
      fetched_at: new Date().toISOString(),
    }, { onConflict: 'cache_key' });
    if (cacheError) console.warn('climate cache write failed (answer still served):', cacheError.message);

    return json({ success: true, data });
  } catch (error) {
    console.error('❌ climate-data-service failed:', error);
    return json({ ...internalError(error, 'climate-data-service'), success: false }, 500);
  }
});
