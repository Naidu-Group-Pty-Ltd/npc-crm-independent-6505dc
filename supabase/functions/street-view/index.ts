import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { verifyAuth, createForbiddenResponse, createUnauthorizedResponse, createCorsHeaders } from '../_shared/auth.ts';
import { requireModulePermission } from '../_shared/authz.ts';
import { enforceCsrf, csrfDenied } from '../_shared/csrfGuard.ts';
import {
  enforceActorQuota,
  enforceIpQuota,
  fetchWithTimeout,
  getClientIp,
  killSwitchActive,
  redactError,
} from '../_shared/publicAbuseControls.ts';
import { clientHttpStatusFor, clientStatusFor, consumeGoogleDailyCap } from '../_shared/googleMapsDailyCaps.ts';
import { imageryProviderOrder } from '../_shared/openLocation/providers.pure.ts';
import {
  MAPILLARY_ATTRIBUTION,
  MAPILLARY_TOKEN_ENV,
  buildMapillaryNearbyUrl,
  mapillaryAuthHeaders,
  parseMapillaryRefusal,
  pickNearestMapillaryImage,
} from '../_shared/openLocation/mapillaryImagery.pure.ts';

// Server-side street imagery proxy. The browser never sees a server key.
// Providers run in the STREET_IMAGERY_PROVIDERS order (default
// mapillary,google): Mapillary serves free, CC BY-SA-attributed imagery
// where its crowd has photographed the street, and Google Street View
// stays selectable and serves exactly as it always has — including on
// every deployment that has not minted a Mapillary token yet, where the
// mapillary branch skips without a network call and nothing changes.
// Both answer the SAME envelope: coverage metadata plus a base64 preview
// when imagery exists, so the panel needs no second shape.

const MAX_WIDTH = 640;
const MAX_HEIGHT = 400;
const CIRCUIT_SCOPE = 'google_street_view';
const MAPILLARY_CIRCUIT_SCOPE = 'mapillary_imagery';

function numeric(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

type Json = (payload: unknown, status?: number) => Response;

Deno.serve(async (req) => {
  const corsHeaders = createCorsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const j: Json = (payload, status = 200) => new Response(
    JSON.stringify(payload),
    { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );

  const csrf = enforceCsrf(req);
  if (!csrf.ok) return csrfDenied(corsHeaders, csrf);

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const { error: authError, userId, authMethod } = await verifyAuth(supabase, req.headers, body as { session_token?: string });
    if (authError || !userId) return createUnauthorizedResponse(authError || 'Authentication required', corsHeaders);
    const permission = await requireModulePermission(supabase, { userId, authMethod }, 'listings', 'can_view');
    if (!permission.ok) return createForbiddenResponse(permission.error || 'Listings access required', corsHeaders);

    const lat = numeric((body as { lat?: unknown }).lat);
    const lng = numeric((body as { lng?: unknown }).lng);
    const heading = numeric((body as { heading?: unknown }).heading) ?? 0;

    if (lat === null || lng === null || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return j({ error: 'invalid_location', success: false }, 400);
    }

    // Abuse controls sit in front of EVERY provider: authorisation first,
    // then per-actor and per-IP ceilings, before anything outbound.
    const actorQuota = await enforceActorQuota(supabase, userId, CIRCUIT_SCOPE, { limit: 30, windowMs: 60_000 });
    const ipQuota = await enforceIpQuota(supabase, getClientIp(req), CIRCUIT_SCOPE, { limit: 60, windowMs: 60_000 });
    if (!actorQuota.ok || !ipQuota.ok) return j({ error: 'rate_limited', success: false }, 429);

    const providers = imageryProviderOrder(Deno.env.get);
    // Was any provider configured and reachable enough to make a claim
    // about coverage? Distinguishes "no imagery of this street" from "no
    // provider could be asked", which the panel renders very differently.
    let sawCoverageAnswer = false;

    for (let i = 0; i < providers.length; i++) {
      const provider = providers[i];
      const isLast = i === providers.length - 1;

      if (provider === 'mapillary') {
        const answer = await serveMapillary(supabase, j, lat, lng);
        if (answer.kind === 'response') return answer.response;
        if (answer.kind === 'no_coverage') sawCoverageAnswer = true;
        continue;
      }

      if (provider === 'google') {
        const answer = await serveGoogleStreetView(supabase, j, lat, lng, heading, isLast);
        if (answer.kind === 'response') return answer.response;
        if (answer.kind === 'no_coverage') sawCoverageAnswer = true;
        continue;
      }
    }

    // Every provider has spoken. At least one was reached and reports no
    // imagery of this location → a genuine coverage answer. None could be
    // asked at all → the unconfigured reading the panel already explains.
    if (sawCoverageAnswer) {
      return j({ success: true, available: false, status: 'ZERO_RESULTS' });
    }
    return j({ error: 'street_view_not_configured', success: false }, 500);
  } catch (error) {
    console.error('[street-view] error', redactError(error));
    return j({ error: 'internal_error', success: false }, 500);
  }
});

type ProviderAnswer =
  | { kind: 'response'; response: Response }
  /** Reached the provider; it holds no imagery here. The chain may still ask the next one. */
  | { kind: 'no_coverage' }
  /** Unconfigured, refused or failed — the next provider's turn, silently. */
  | { kind: 'skipped' };

// deno-lint-ignore no-explicit-any
async function serveMapillary(supabase: any, j: Json, lat: number, lng: number): Promise<ProviderAnswer> {
  const token = Deno.env.get(MAPILLARY_TOKEN_ENV);
  if (!token) return { kind: 'skipped' };
  if (killSwitchActive('MAPILLARY_KILL_SWITCH')) return { kind: 'skipped' };

  // Same circuit posture as the Google branch below: an unreadable circuit
  // store says nothing about Mapillary, so it proceeds; a genuinely open
  // one hands the request to the next provider rather than 503ing a chain
  // that may still have an answer.
  const { data: circuitOpen, error: circuitReadError } = await supabase.rpc('provider_circuit_is_open', { p_scope: MAPILLARY_CIRCUIT_SCOPE });
  if (circuitReadError) {
    console.warn('[street-view] mapillary circuit state unreadable, proceeding:', circuitReadError.message);
  } else if (circuitOpen === true) {
    return { kind: 'skipped' };
  }

  try {
    const res = await fetchWithTimeout(
      buildMapillaryNearbyUrl(lat, lng),
      { headers: { ...mapillaryAuthHeaders(token), Accept: 'application/json' } },
      6000,
    );
    const bodyJson = await res.json().catch(() => ({}));
    const refusal = parseMapillaryRefusal(bodyJson);
    if (!res.ok || refusal.refused) {
      console.warn(`[street-view] mapillary refused (${res.status}${refusal.refused ? `, ${refusal.kind}` : ''})`);
      await supabase.rpc('provider_circuit_record_failure', { p_scope: MAPILLARY_CIRCUIT_SCOPE, p_threshold: 20, p_open_seconds: 60 });
      return { kind: 'skipped' };
    }

    const image = pickNearestMapillaryImage(bodyJson, { lat, lng });
    if (image === null) {
      // Reached, answered, holds nothing here — a fact about Mapillary's
      // coverage of this street, not a fault.
      await supabase.rpc('provider_circuit_record_success', { p_scope: MAPILLARY_CIRCUIT_SCOPE });
      return { kind: 'no_coverage' };
    }

    const imageResponse = await fetchWithTimeout(image.thumbUrl, {}, 8000);
    if (!imageResponse.ok) {
      await supabase.rpc('provider_circuit_record_failure', { p_scope: MAPILLARY_CIRCUIT_SCOPE, p_threshold: 20, p_open_seconds: 60 });
      return { kind: 'skipped' };
    }
    await supabase.rpc('provider_circuit_record_success', { p_scope: MAPILLARY_CIRCUIT_SCOPE });

    const bytes = new Uint8Array(await imageResponse.arrayBuffer());
    let binary = '';
    for (let k = 0; k < bytes.length; k += 1) binary += String.fromCharCode(bytes[k]);
    const base64 = btoa(binary);

    return {
      kind: 'response',
      response: j({
        success: true,
        available: true,
        imageDataUrl: `data:image/jpeg;base64,${base64}`,
        panoramaDate: image.capturedYearMonth,
        copyright: MAPILLARY_ATTRIBUTION,
      }),
    };
  } catch (error) {
    console.warn('[street-view] mapillary unreachable:', (error as Error).message);
    await supabase.rpc('provider_circuit_record_failure', { p_scope: MAPILLARY_CIRCUIT_SCOPE, p_threshold: 20, p_open_seconds: 60 });
    return { kind: 'skipped' };
  }
}

async function serveGoogleStreetView(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  j: Json,
  lat: number,
  lng: number,
  heading: number,
  isLastProvider: boolean,
): Promise<ProviderAnswer> {
  const apiKey = Deno.env.get('GOOGLE_MAPS_API_KEY');
  if (!apiKey) {
    // The chain's unconfigured reading covers this when no provider at
    // all could serve; when another provider already answered coverage,
    // a missing Google key is simply a skipped branch.
    return { kind: 'skipped' };
  }
  if (killSwitchActive('GOOGLE_STREET_VIEW_KILL_SWITCH')) {
    if (isLastProvider) return { kind: 'response', response: j({ error: 'temporarily_unavailable', success: false }, 503) };
    return { kind: 'skipped' };
  }

  // A circuit breaker reports whether GOOGLE is failing. If our own circuit
  // store cannot be read, that says nothing about Google — treating it as
  // "open" converts a local database gap into a total outage of the feature,
  // which is exactly what happened here: the provider_circuit_* migration
  // (20260724000000) was never applied, so every read errored and every
  // request 503'd. Fail closed on a genuinely open circuit; fail open on an
  // unreadable one, and log so the gap is visible.
  const { data: circuitOpen, error: circuitReadError } = await supabase.rpc('provider_circuit_is_open', { p_scope: CIRCUIT_SCOPE });
  if (circuitReadError) {
    console.warn('[street-view] circuit state unreadable, proceeding:', circuitReadError.message);
  } else if (circuitOpen === true) {
    if (isLastProvider) return { kind: 'response', response: j({ error: 'temporarily_unavailable', success: false }, 503) };
    return { kind: 'skipped' };
  }

  const location = `${lat},${lng}`;

  // Metadata is FREE and is counted with the imagery anyway — a deliberate
  // over-count, because a second counter for a SKU that costs nothing buys
  // nothing and over-counting spend is the safe direction. One unit per
  // request either way, which is what keeps the ceiling honest.
  const metadataQuota = await consumeGoogleDailyCap(supabase, 'streetView');
  if (!metadataQuota.ok) {
    console.warn(`[street-view] metadata not attempted (${metadataQuota.reason})`);
    if (isLastProvider) {
      return {
        kind: 'response',
        response: j(
          { error: clientStatusFor(metadataQuota.reason), success: false },
          clientHttpStatusFor(metadataQuota.reason),
        ),
      };
    }
    return { kind: 'skipped' };
  }

  const metaResponse = await fetchWithTimeout(
    `https://maps.googleapis.com/maps/api/streetview/metadata?location=${encodeURIComponent(location)}&key=${apiKey}`,
    {},
    6000,
  );
  const meta = await metaResponse.json().catch(() => ({}));

  if (meta.status !== 'OK') {
    if (meta.status !== 'ZERO_RESULTS') {
      await supabase.rpc('provider_circuit_record_failure', { p_scope: CIRCUIT_SCOPE, p_threshold: 20, p_open_seconds: 60 });
      if (isLastProvider) {
        return { kind: 'response', response: j({ success: true, available: false, status: String(meta.status ?? 'UNKNOWN') }) };
      }
      return { kind: 'skipped' };
    }
    // Google's own "no panorama here" — a coverage answer, final for this
    // provider; the chain decides whether another provider still gets a turn.
    if (isLastProvider) {
      return { kind: 'response', response: j({ success: true, available: false, status: 'ZERO_RESULTS' }) };
    }
    return { kind: 'no_coverage' };
  }

  const params = new URLSearchParams({
    size: `${MAX_WIDTH}x${MAX_HEIGHT}`,
    location,
    fov: '80',
    heading: String(((heading % 360) + 360) % 360),
    pitch: '0',
    return_error_code: 'true',
    key: apiKey,
  });

  const imageQuota = await consumeGoogleDailyCap(supabase, 'streetView');
  if (!imageQuota.ok) {
    console.warn(`[street-view] image not attempted (${imageQuota.reason})`);
    if (isLastProvider) {
      return {
        kind: 'response',
        response: j(
          { error: clientStatusFor(imageQuota.reason), success: false },
          clientHttpStatusFor(imageQuota.reason),
        ),
      };
    }
    return { kind: 'skipped' };
  }
  const imageResponse = await fetchWithTimeout(`https://maps.googleapis.com/maps/api/streetview?${params.toString()}`, {}, 6000);
  if (!imageResponse.ok) {
    await supabase.rpc('provider_circuit_record_failure', { p_scope: CIRCUIT_SCOPE, p_threshold: 20, p_open_seconds: 60 });
    if (isLastProvider) {
      return { kind: 'response', response: j({ success: true, available: false, status: `image_${imageResponse.status}` }) };
    }
    return { kind: 'skipped' };
  }
  await supabase.rpc('provider_circuit_record_success', { p_scope: CIRCUIT_SCOPE });

  const bytes = new Uint8Array(await imageResponse.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  const base64 = btoa(binary);

  return {
    kind: 'response',
    response: j({
      success: true,
      available: true,
      imageDataUrl: `data:image/jpeg;base64,${base64}`,
      panoramaDate: typeof meta.date === 'string' ? meta.date : null,
      copyright: typeof meta.copyright === 'string' ? meta.copyright.slice(0, 200) : null,
    }),
  };
}
