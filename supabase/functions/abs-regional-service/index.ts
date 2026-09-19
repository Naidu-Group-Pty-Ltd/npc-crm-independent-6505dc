import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { internalError } from '../_shared/errorResponse.ts';
import { parseJsonBody } from '../_shared/validate.ts';
import { RegionalTrendsRequest, PUBLIC_SERVICE_MAX_BODY_BYTES } from '../_shared/publicServiceSchemas.ts';
import { sourceUnavailable } from '../_shared/sourceUnavailable.pure.ts';
import { assessAuPoint } from '../_shared/auGeoSanity.pure.ts';
import { buildPopulationReading, type PopulationObsRow } from '../_shared/absRegional.pure.ts';

/**
 * Regional trends reading — the property's own SA2, its measured population
 * series and growth, from the loaded ABS Regional population release.
 *
 * The COORDINATE is the question: the ABS ASGS2021 geoserver answers a
 * point query with the SA2 containing it (measured from this project's
 * egress 2026-09-06 — Parramatta example resolves to 125041717
 * "Parramatta - North"), and the reading is that SA2's own series. This is
 * deliberately finer than the postcode: an SA2 is the ABS's own unit for
 * regional population, and serving the containing area's measured figures
 * beats aggregating estimates onto a geography the source never published.
 *
 * Rules:
 *  - a request without a coordinate answers `no_data_for_location`
 *    honestly (the generator passes the verified coordinate after location
 *    intelligence resolves it);
 *  - SA2 resolutions cache per ~110 m cell (3 decimal places —
 *    `sa2_point_cache`); a transport failure is never cached, and a point
 *    the geoserver puts in no SA2 answers honestly rather than guessing a
 *    neighbour;
 *  - the reading carries the release's own vintage (ERP at 30 June of the
 *    latest year) and growth windows render only where both endpoints were
 *    measured;
 *  - unemployment is deliberately ABSENT from this response for now: the
 *    SALM register (DEWR) refuses this project's egress and is loaded by an
 *    operator; until it holds rows there is no figure, and no figure is
 *    served.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

const GEO_TIMEOUT_MS = 15_000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

interface Sa2Identity {
  code: string;
  name: string;
}

/** Point → SA2 via the ABS ASGS2021 geoserver. Null when the point is in no SA2. */
async function resolveSa2(latitude: number, longitude: number): Promise<Sa2Identity | null> {
  const params = new URLSearchParams({
    geometry: `${longitude},${latitude}`,
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'SA2_CODE_2021,SA2_NAME_2021',
    returnGeometry: 'false',
    f: 'json',
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEO_TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://geo.abs.gov.au/arcgis/rest/services/ASGS2021/SA2/MapServer/0/query?${params}`,
      { signal: controller.signal },
    );
    if (!res.ok) throw new Error(`ABS geoserver answered ${res.status}`);
    const body = await res.json() as {
      error?: unknown;
      features?: Array<{ attributes?: { sa2_code_2021?: string; sa2_name_2021?: string } }>;
    };
    // ArcGIS reports failures as 200 + an error body; treat it as transport.
    if (body.error) throw new Error(`ABS geoserver returned an error body`);
    const attrs = body.features?.[0]?.attributes;
    if (!attrs?.sa2_code_2021) return null;
    return { code: attrs.sa2_code_2021, name: attrs.sa2_name_2021 ?? attrs.sa2_code_2021 };
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const __parsed = await parseJsonBody(req, RegionalTrendsRequest, corsHeaders, PUBLIC_SERVICE_MAX_BODY_BYTES);
    if (!__parsed.ok) return __parsed.response;
    const { latitude, longitude, state } = __parsed.data;

    if (latitude === undefined || longitude === undefined) {
      return json(sourceUnavailable(
        'abs-regional',
        'no_data_for_location',
        'Regional trends are read for the SA2 containing the property coordinate, and this request carried none — figures are unavailable rather than approximated. The generator passes the verified coordinate once location intelligence has resolved it.',
      ));
    }
    const verdict = assessAuPoint(latitude, longitude, state ?? null);
    if (!verdict.ok) {
      return json(sourceUnavailable(
        'abs-regional',
        'no_data_for_location',
        `The coordinate fails the Australia gate (${verdict.reason}) — regional trends are unavailable rather than read for the wrong place.`,
      ));
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // ~110 m cell: SA2s are small enough that a coarser cell spans boundaries.
    const cacheKey = `${latitude.toFixed(3)},${longitude.toFixed(3)}`;
    let sa2: Sa2Identity | null = null;
    const { data: cachedPoint } = await supabase
      .from('sa2_point_cache')
      .select('sa2_code, sa2_name')
      .eq('cache_key', cacheKey)
      .maybeSingle();
    if (cachedPoint) {
      sa2 = { code: cachedPoint.sa2_code, name: cachedPoint.sa2_name };
    } else {
      try {
        sa2 = await resolveSa2(latitude, longitude);
      } catch (err) {
        console.error('[abs-regional-service] SA2 resolution failed:', err);
        return json(sourceUnavailable(
          'abs-regional',
          'provider_error',
          'The ABS geoserver could not be reached to resolve the SA2 for this coordinate — regional trends are unavailable for this request rather than guessed.',
        ));
      }
      if (sa2) {
        // Only a real resolution is cached — never a transport failure.
        await supabase.from('sa2_point_cache').upsert(
          { cache_key: cacheKey, sa2_code: sa2.code, sa2_name: sa2.name, resolved_at: new Date().toISOString() },
          { onConflict: 'cache_key' },
        );
      }
    }

    if (!sa2) {
      return json(sourceUnavailable(
        'abs-regional',
        'no_data_for_location',
        'The ABS ASGS2021 SA2 layer places this coordinate in no statistical area — regional trends are unavailable for it.',
      ));
    }

    const [{ data: metaRow, error: metaError }, { data: obsRows, error: obsError }] = await Promise.all([
      supabase.from('abs_sa2_meta')
        .select('sa2_name, state_name, sa3_name, sa4_name, release, last_year')
        .eq('sa2_code', sa2.code)
        .maybeSingle(),
      supabase.from('abs_sa2_population')
        .select('year, erp')
        .eq('sa2_code', sa2.code)
        .order('year', { ascending: true })
        .limit(100),
    ]);
    if (metaError) throw new Error(`abs_sa2_meta read failed: ${metaError.message}`);
    if (obsError) throw new Error(`abs_sa2_population read failed: ${obsError.message}`);

    if (!metaRow || !obsRows || obsRows.length === 0) {
      return json(sourceUnavailable(
        'abs-regional',
        'not_configured',
        `The regional population register holds no rows for SA2 ${sa2.code} (${sa2.name}) — run abs-regional-ingest. Figures are unavailable rather than approximated.`,
      ));
    }

    const population = buildPopulationReading(
      (obsRows as PopulationObsRow[]).map((r) => ({ year: Number(r.year), erp: Number(r.erp) })),
      metaRow.release,
    );
    if (!population) {
      return json(sourceUnavailable(
        'abs-regional',
        'not_configured',
        `The stored series for SA2 ${sa2.code} holds no usable observation — regional trends are unavailable.`,
      ));
    }

    return json({
      success: true,
      data: {
        sa2: {
          code: sa2.code,
          name: metaRow.sa2_name ?? sa2.name,
          state: metaRow.state_name,
          sa3: metaRow.sa3_name,
          sa4: metaRow.sa4_name,
        },
        population,
        // The SALM register is operator-loaded (DEWR refuses this project's
        // egress); until it holds rows, unemployment has no figure and
        // serves none — absent, never approximated.
        unemployment: null,
        retrievedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('Error in abs-regional-service:', error);
    return json({ success: false, ...internalError(error, 'abs-regional-service') }, 500);
  }
});
