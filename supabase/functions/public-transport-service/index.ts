import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { parseJsonBody } from '../_shared/validate.ts';
import { PublicTransportRequest, PUBLIC_SERVICE_MAX_BODY_BYTES } from '../_shared/publicServiceSchemas.ts';
import { sourceUnavailable } from '../_shared/sourceUnavailable.pure.ts';
import { internalError } from '../_shared/errorResponse.ts';
import {
  COVERAGE_RADIUS_M, NEARBY_RADIUS_M, boundingBox, readTransport, type StoredStop,
} from '../_shared/transportReading.pure.ts';

/**
 * Public transport near a property, measured from its own coordinate.
 *
 * ## What this used to do
 *
 * Kept on record because it is the clearest example of the fabrication class
 * this platform removed: eight per-state "fetchers" that **ignored the
 * coordinate entirely** and returned a hard-coded landmark list. Every NSW
 * property, wherever it stood, was 450m from Central Station with the T1-T8
 * lines; every VIC property 250m from a Swanston Street tram; and so on for
 * all eight states and territories, each with an invented `qualityScore` and
 * a summary reading "Excellent public transport access". The result was
 * cached for 30 days (`transport_data_cache` held 639 rows at removal; not
 * one live) and flowed into `location-intelligence-service`, where the
 * invented `qualityScore` drove up to 30 points of every report's walk score
 * and "Nearest Station: Central Station" was printed on properties hundreds
 * of kilometres from it. A `generateFallbackData` beneath it invented a
 * DIFFERENT answer ("Unknown", 999m, score 25) for the error path.
 *
 * It has answered `sourceUnavailable` since that removal. This is the real
 * source: `transport_stops`, loaded from each operator's own published GTFS
 * feed by `transport-gtfs-ingest`.
 *
 * ## The rule that governs an empty answer
 *
 * **A stop found is a fact about the area; no stop found is a fact about the
 * FEEDS.** Four networks are loaded and nothing else, so a Perth property is
 * not badly served — it is outside every feed this platform holds, and
 * "no stops nearby" about it would be the confident-answer-against-nothing
 * failure removed twice already. `outside_loaded_networks` and
 * `none_within_radius` are therefore different answers and this never
 * collapses them; the first is returned as `no_data_for_location` naming the
 * networks that ARE held.
 *
 * ## No score, and no mode
 *
 * Nothing here returns a rating, grade or `qualityScore`. The invented one is
 * exactly what corrupted the walk score, and a score computed from stop
 * counts alone would be a new invention wearing the same clothes: a stop
 * whose service is hourly counts the same as one served every four minutes,
 * and frequency is not measured. Mode is absent for the same reason
 * (`route_type` is NULL on every row loaded), and `notMeasured` says both in
 * words a report can print.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

// `loaded_at` is the reading's own currency: without it a report states a
// stop count and its source and never says WHEN the feed behind it was
// current. The column has always existed; nothing selected it.
const STOP_COLUMNS = 'feed, stop_id, stop_name, lat, lon, location_type, parent_station, route_type, source_label, loaded_at';

/**
 * How many rows the far query takes when nothing is close. Enough to name the
 * nearest place honestly, and bounded because the only question it answers is
 * "does any loaded feed reach here at all".
 */
const FAR_QUERY_LIMIT = 200;

interface PublicTransportInput {
  lat: number;
  lng: number;
  state: string;
  suburb?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // WP-24: bounded and shape-checked. This endpoint takes no session,
    // so a bare req.json() read whatever was sent.
    const __parsed = await parseJsonBody(req, PublicTransportRequest, corsHeaders, PUBLIC_SERVICE_MAX_BODY_BYTES);
    if (!__parsed.ok) return __parsed.response;
    const input: PublicTransportInput = __parsed.data;

    const { lat, lng, state } = input;
    if (!lat || !lng || !state) {
      const missingParams = [];
      if (!lat) missingParams.push('lat');
      if (!lng) missingParams.push('lng');
      if (!state) missingParams.push('state');
      return new Response(JSON.stringify({
        success: false,
        error: `Missing required parameters: ${missingParams.join(', ')}`,
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const near = boundingBox(lat, lng, NEARBY_RADIUS_M);
    const { data: nearRows, error: nearError } = await supabase
      .from('transport_stops')
      .select(STOP_COLUMNS)
      .gte('lat', near.minLat).lte('lat', near.maxLat)
      .gte('lon', near.minLon).lte('lon', near.maxLon);

    // A failed read is not an empty area. It answers 503 so a caller can
    // retry, rather than reporting "no transport here" about a database
    // fault — the `aml.cases` lesson: a read that FAILED is not a row that is
    // ABSENT.
    if (nearError) {
      console.error('[public-transport-service] stop read failed:', nearError.message);
      return new Response(JSON.stringify(sourceUnavailable(
        'public-transport',
        'provider_error',
        'The public transport stop register could not be read. This is a fault rather than an absence of stops, and is worth retrying.',
      )), { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    let candidates = (nearRows ?? []) as StoredStop[];

    // Nothing close. The remaining question is whether a loaded feed reaches
    // here at all, which is a different answer and needs the wider window.
    if (candidates.length === 0) {
      const far = boundingBox(lat, lng, COVERAGE_RADIUS_M);
      const { data: farRows, error: farError } = await supabase
        .from('transport_stops')
        .select(STOP_COLUMNS)
        .gte('lat', far.minLat).lte('lat', far.maxLat)
        .gte('lon', far.minLon).lte('lon', far.maxLon)
        .limit(FAR_QUERY_LIMIT);
      if (farError) {
        console.error('[public-transport-service] coverage read failed:', farError.message);
        return new Response(JSON.stringify(sourceUnavailable(
          'public-transport',
          'provider_error',
          'The public transport stop register could not be read. This is a fault rather than an absence of stops, and is worth retrying.',
        )), { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      candidates = (farRows ?? []) as StoredStop[];
    }

    const reading = readTransport(lat, lng, candidates, NEARBY_RADIUS_M);

    if (reading.verdict === 'outside_loaded_networks') {
      // Which networks ARE held, read from the register rather than listed
      // here, so this can never claim a feed that is not loaded.
      const { data: loaded } = await supabase
        .from('transport_feed_syncs')
        .select('feed')
        .eq('status', 'succeeded');
      const networks = [...new Set((loaded ?? []).map((r) => (r as { feed: string }).feed))].sort();
      return new Response(JSON.stringify(sourceUnavailable(
        'public-transport',
        'no_data_for_location',
        'No public transport feed loaded by this deployment covers this location, so no stop distance can be '
        + 'measured for it. This is a limit of the data held, not a finding about the area. '
        + `Networks currently loaded: ${networks.length > 0 ? networks.join(', ') : 'none'}.`,
      )), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({
      success: true,
      data: {
        verdict: reading.verdict,
        stops: reading.stops,
        stopsWithinRadius: reading.countWithinRadius,
        radiusMetres: reading.radiusMetres,
        nearest: reading.nearest,
        feeds: reading.feeds,
        sources: reading.sources,
        notMeasured: reading.notMeasured,
        // The reading's own currency. `readTransport` derives it from the
        // contributing feeds' `loaded_at`, and it was being computed and then
        // dropped at this boundary — so every caller received a stop count
        // with no way to say when the data behind it was current.
        feedLoadedAt: reading.feedLoadedAt,
      },
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('❌ Error in public-transport-service:', error);
    return new Response(JSON.stringify({
      success: false,
      ...internalError(error, 'public-transport-service'),
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
