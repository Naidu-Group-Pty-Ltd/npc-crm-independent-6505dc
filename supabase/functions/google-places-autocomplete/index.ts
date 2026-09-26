import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createCorsHeaders } from "../_shared/auth.ts";
import { enforceJsonBodyLimit } from '../_shared/requestSecurity.ts';
import {
  enforceIpQuota,
  enforceKeyQuota,
  fetchWithTimeout,
  getClientIp,
  killSwitchActive,
  redactError,
  sanitizeShortText,
} from "../_shared/publicAbuseControls.ts";
import { clientHttpStatusFor, clientStatusFor, consumeGoogleDailyCap } from '../_shared/googleMapsDailyCaps.ts';
import { consumeOsmDailyAllowance } from '../_shared/geocode/osmAllowance.ts';
import { PHOTON_PUBLIC_BASE, isPublicPhotonBase, photonSearchUrl, predictionsFromPhoton } from '../_shared/geocode/osmAutocomplete.pure.ts';
import { GEOCODER_USER_AGENT } from '../_shared/geocode/geocoder.ts';

// WP-10 — address autocomplete abuse controls.
//   * Provider: OpenStreetMap's Photon by default (`ADDRESS_AUTOCOMPLETE_PROVIDER`
//     unset or `osm`); Google Places Autocomplete only where an operator sets
//     `google` and a key. The form reads one projection whichever answers.
//   * Per-IP + per-session quotas, and a daily allowance per provider
//     (`OSM_AUTOCOMPLETE_DAILY_LIMIT` / `GOOGLE_PLACES_AUTOCOMPLETE_DAILY_LIMIT`).
//   * Input cap + control-char reject.
//   * Response projection (only fields callers actually need).
//   * Timeout + circuit breaker (per provider) + redacted upstream errors.
//   * Kill switch: GOOGLE_PLACES_KILL_SWITCH — the endpoint, whichever provider.

/** The breaker is per provider: an outage at one must not open the other. */
const CIRCUIT_SCOPES = { google: 'google_places', osm: 'osm_autocomplete' } as const;

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const j = (payload: unknown, status = 200) => new Response(
    JSON.stringify(payload),
    { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );

  if (killSwitchActive('GOOGLE_PLACES_KILL_SWITCH')) {
    return j({ error: 'temporarily_unavailable', success: false }, 503);
  }

  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    // Which service suggests addresses. `osm` (the default) is OpenStreetMap's
    // Photon, free and built for search-as-you-type; `google` is the Places
    // Autocomplete this function was written for, and needs the key. Google
    // refused every request from 12 Sep 2026 and the product must not depend
    // on its console, so Google is the choice an operator makes, never the
    // fallback taken silently — and any other spelling is the default.
    const provider: keyof typeof CIRCUIT_SCOPES =
      (Deno.env.get('ADDRESS_AUTOCOMPLETE_PROVIDER') || 'osm').trim().toLowerCase() === 'google' ? 'google' : 'osm';
    const apiKey = Deno.env.get('GOOGLE_MAPS_API_KEY');
    if (provider === 'google' && !apiKey) return j({ error: 'Places service not configured', success: false }, 500);
    const CIRCUIT_SCOPE = CIRCUIT_SCOPES[provider];
    const { data: circuitOpen, error: circuitReadError } = await supabase.rpc('provider_circuit_is_open', { p_scope: CIRCUIT_SCOPE });
    if (circuitReadError) return j({ error: 'temporarily_unavailable', success: false }, 503);
    if (circuitOpen === true) return j({ error: 'temporarily_unavailable', success: false }, 503);

    // WP-24: bounded. Every field below is sanitised, but the READ was not —
    // `req.json()` takes whatever is sent, and nothing authenticates this
    // endpoint. 8 KiB is far beyond an autocomplete fragment.
    const __bounded = await enforceJsonBodyLimit<Record<string, unknown>>(req, 8 * 1024);
    if (!__bounded.ok) return __bounded.error;
    const body = __bounded.value ?? {};
    const input = sanitizeShortText(body.input, 120);
    const sessionToken = sanitizeShortText(body.sessionToken, 64);

    if (!input || input.length < 3) return j({ success: true, predictions: [] });

    const ip = getClientIp(req);

    // Atomic quotas — layered.
    const ipCheck = await enforceIpQuota(supabase, ip, 'google_places', { limit: 30, windowMs: 60_000 });
    if (!ipCheck.ok) return j({ error: 'rate_limited', success: false }, 429);
    if (sessionToken) {
      const sess = await enforceKeyQuota(supabase, sessionToken, 'google_places_session', { limit: 60, windowMs: 60_000 });
      if (!sess.ok) return j({ error: 'rate_limited', success: false }, 429);
    }
    // Autocomplete is its own Google billing SKU at its own price, so it has
    // its own allowance. It used to share one `google_places` bucket with the
    // Nearby Search a report's amenity lookups make, which meant a busy address
    // field could spend the budget a client's report needed.
    //
    // The IP and session quotas above are abuse control and are unchanged; this
    // is the spending ceiling, and it fails closed when the shared counter
    // cannot be reached. Autocomplete then degrades to "no suggestions", which
    // is still a form an operator can type into.
    if (provider !== 'google') {
      // OpenStreetMap's Photon. Its own daily allowance (its usage policy is
      // fair use, and a ceiling is what keeps a busy form fair), its own
      // circuit breaker, the same projection — the form cannot tell which
      // service answered, and does not need to. The allowance fails closed
      // and its refusal is read through the one shared mapping: an exhausted
      // allowance clears tomorrow, an unreadable counter does not, and the
      // caller is told which.
      //
      // The allowance is what the PUBLIC instance is owed; a copy this product
      // runs itself (`AUTOCOMPLETE_PHOTON_URL`, the address service) is not
      // held to it, by the same rule the geocoding chain reads.
      const base = (Deno.env.get('AUTOCOMPLETE_PHOTON_URL') || PHOTON_PUBLIC_BASE).trim();
      if (isPublicPhotonBase(base)) {
        const osmBudget = await consumeOsmDailyAllowance(supabase, 'autocomplete');
        if (!osmBudget.ok) {
          console.warn(`[google-places-autocomplete] osm not attempted (${osmBudget.reason})`);
          return j(
            { error: clientStatusFor(osmBudget.reason), success: false },
            clientHttpStatusFor(osmBudget.reason),
          );
        }
      }
      let osmResponse: Response;
      try {
        osmResponse = await fetchWithTimeout(photonSearchUrl(base, input), { headers: { 'User-Agent': GEOCODER_USER_AGENT, Accept: 'application/json' } }, 5000);
      } catch (e) {
        const { error: circuitWriteError } = await supabase.rpc('provider_circuit_record_failure', { p_scope: CIRCUIT_SCOPE, p_threshold: 20, p_open_seconds: 60 });
        if (circuitWriteError) return j({ error: 'temporarily_unavailable', success: false }, 503);
        console.warn('[google-places-autocomplete] osm upstream timeout/abort', redactError(e));
        return j({ error: 'upstream_timeout', success: false }, 504);
      }
      if (!osmResponse.ok) {
        await osmResponse.body?.cancel();
        const { error: circuitWriteError } = await supabase.rpc('provider_circuit_record_failure', { p_scope: CIRCUIT_SCOPE, p_threshold: 20, p_open_seconds: 60 });
        if (circuitWriteError) return j({ error: 'temporarily_unavailable', success: false }, 503);
        console.error('[google-places-autocomplete] osm answered', osmResponse.status);
        return j({ error: 'upstream_error', success: false }, 502);
      }
      const osmData = await osmResponse.json().catch(() => null);
      const { error: circuitResetError } = await supabase.rpc('provider_circuit_record_success', { p_scope: CIRCUIT_SCOPE });
      if (circuitResetError) return j({ error: 'temporarily_unavailable', success: false }, 503);
      return j({ success: true, predictions: predictionsFromPhoton(osmData, input, 8) });
    }

    if (!apiKey) return j({ error: 'Places service not configured', success: false }, 500);
    const globalCheck = await consumeGoogleDailyCap(supabase, 'placesAutocomplete');
    if (!globalCheck.ok) {
      // The exact reason goes to the log; the caller is told only whether this
      // is an exhausted allowance (which clears tomorrow) or unavailability
      // (which does not). Reporting a kill switch or an unreachable counter as
      // "daily quota exceeded" sends an operator away to wait for a state that
      // waiting will not change.
      console.warn(`[google-places-autocomplete] not attempted (${globalCheck.reason})`);
      return j(
        { error: clientStatusFor(globalCheck.reason), success: false },
        clientHttpStatusFor(globalCheck.reason),
      );
    }

    const params = new URLSearchParams({
      input,
      types: 'address',
      components: 'country:au',
      key: apiKey,
      ...(sessionToken ? { sessiontoken: sessionToken } : {}),
    });

    let response: Response;
    try {
      response = await fetchWithTimeout(
        `https://maps.googleapis.com/maps/api/place/autocomplete/json?${params.toString()}`,
        {},
        5000,
      );
    } catch (e) {
      const { error: circuitWriteError } = await supabase.rpc('provider_circuit_record_failure', { p_scope: CIRCUIT_SCOPE, p_threshold: 20, p_open_seconds: 60 });
      if (circuitWriteError) return j({ error: 'temporarily_unavailable', success: false }, 503);
      console.warn('[google-places-autocomplete] upstream timeout/abort', redactError(e));
      return j({ error: 'upstream_timeout', success: false }, 504);
    }

    const data = await response.json().catch(() => ({}));

    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      const { error: circuitWriteError } = await supabase.rpc('provider_circuit_record_failure', { p_scope: CIRCUIT_SCOPE, p_threshold: 20, p_open_seconds: 60 });
      if (circuitWriteError) return j({ error: 'temporarily_unavailable', success: false }, 503);
      console.error('Google Places API error:', data.status);
      return j({ error: 'upstream_error', success: false }, 502);
    }

    const { error: circuitResetError } = await supabase.rpc('provider_circuit_record_success', { p_scope: CIRCUIT_SCOPE });
    if (circuitResetError) return j({ error: 'temporarily_unavailable', success: false }, 503);

    // Response projection — never leak arbitrary provider fields.
    const predictions = (data.predictions || []).slice(0, 10).map((p: Record<string, unknown>) => ({
      placeId: String(p.place_id ?? '').slice(0, 200),
      description: String(p.description ?? '').slice(0, 300),
      mainText: String((p.structured_formatting as Record<string, unknown>)?.main_text ?? '').slice(0, 200),
      secondaryText: String((p.structured_formatting as Record<string, unknown>)?.secondary_text ?? '').slice(0, 200),
    }));

    return j({ success: true, predictions });
  } catch (error) {
    console.error('Places autocomplete error:', error);
    return j({ error: redactError(error), success: false }, 500);
  }
});
