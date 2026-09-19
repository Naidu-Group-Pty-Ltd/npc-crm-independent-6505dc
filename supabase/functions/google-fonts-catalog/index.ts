/**
 * Google Fonts catalogue proxy.
 *
 * Why this exists
 * ---------------
 * `src/hooks/useGoogleFonts.ts` called the Google Fonts Developer API directly
 * from the browser with the key written into the source:
 *
 *     fetch('https://www.googleapis.com/webfonts/v1/webfonts?...&key=AIzaSy...')
 *
 * A key in a frontend module is not a secret. Vite inlines it into the built
 * bundle, so it is served to every visitor, readable in devtools, and archived
 * by anyone who has ever fetched the app. It is also billable and — per
 * `docs/integrations/API_USAGE_METERING.md` — a workspace provisioned by Mission
 * Control runs on the PRIME's vendor keys, so the quota being burned is somebody
 * else's, recharged per tenant. A leaked key is a bill, not just a secret.
 *
 * The comment above that call read "no key needed for basic list", which was
 * true of the endpoint it was originally written against and not of the one it
 * ended up calling.
 *
 * So: the key lives in `GOOGLE_FONTS_API_KEY` on the server, this function is
 * the only thing that holds it, and the browser gets the catalogue instead.
 *
 * Design notes
 * ------------
 * - Staff-only. The catalogue drives Template Builder's font picker; there is
 *   no reason for an anonymous caller to spend the key.
 * - Cached in-isolate for an hour. The catalogue changes a few times a year, and
 *   without this every picker keystroke that triggered a refetch would be a
 *   billable upstream call.
 * - Degrades to 503 with a reason the client can act on, rather than throwing.
 *   The hook keeps its curated fallback list, so the picker still works.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { createCorsHeaders } from '../_shared/auth.ts';
import { verifyHuman, securityJsonError } from '../_shared/requestSecurity.ts';
import { enforceActorQuota } from '../_shared/publicAbuseControls.ts';

interface CatalogueFont {
  family: string;
  variants: string[];
  category: string;
}

const CACHE_TTL_MS = 60 * 60 * 1000;
let cache: { at: number; fonts: CatalogueFont[] } | null = null;

Deno.serve(async (req) => {
  const corsHeaders = createCorsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const json = (payload: unknown, status = 200) =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // The body may carry a legacy session token; read it defensively so a GET
    // or an empty body does not throw before authentication runs.
    let body: { session_token?: string; command_centre_session_token?: string } = {};
    if (req.method === 'POST') {
      body = await req.json().catch(() => ({}));
    }

    const auth = await verifyHuman(supabase, req, body);
    if (!auth.ok || !auth.actorId) {
      return securityJsonError(401, 'authentication_required');
    }

    // Defence in depth against a staff client looping the picker. The upstream
    // catalogue is one call an hour at most thanks to the cache below; this
    // bounds the pathological case where the cache is cold and a client retries.
    const quota = await enforceActorQuota(supabase, auth.actorId, 'google-fonts-catalog', {
      limit: 60,
      windowMs: 15 * 60 * 1000,
    });
    if (!quota.ok) {
      return securityJsonError(429, 'rate_limited');
    }

    if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
      return json({ success: true, fonts: cache.fonts, cached: true });
    }

    const apiKey = (Deno.env.get('GOOGLE_FONTS_API_KEY') || '').trim();
    if (!apiKey) {
      // Not an error the caller can fix, and not a reason to throw: the hook
      // keeps its built-in list when this happens.
      console.warn('[google-fonts-catalog] GOOGLE_FONTS_API_KEY is not configured');
      return json({ success: false, error: 'font_catalogue_unavailable', fonts: [] }, 503);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    let upstream: Response;
    try {
      upstream = await fetch(
        `https://www.googleapis.com/webfonts/v1/webfonts?sort=popularity&key=${encodeURIComponent(apiKey)}`,
        { signal: controller.signal },
      );
    } finally {
      clearTimeout(timer);
    }

    if (!upstream.ok) {
      // Never surface the upstream body — a Google API error echoes the request
      // URL, and the request URL contains the key.
      console.error('[google-fonts-catalog] upstream failed', { status: upstream.status });
      return json({ success: false, error: 'font_catalogue_unavailable', fonts: [] }, 503);
    }

    const data = await upstream.json();
    const fonts: CatalogueFont[] = Array.isArray(data?.items)
      ? data.items.map((item: Record<string, unknown>) => ({
          family: String(item.family ?? ''),
          variants: Array.isArray(item.variants) ? (item.variants as string[]) : ['regular'],
          category: String(item.category ?? 'sans-serif'),
        })).filter((f: CatalogueFont) => f.family.length > 0)
      : [];

    if (fonts.length > 0) cache = { at: Date.now(), fonts };

    return json({ success: true, fonts, cached: false });
  } catch (error) {
    console.error('[google-fonts-catalog] error', error instanceof Error ? error.message : String(error));
    return json({ success: false, error: 'font_catalogue_unavailable', fonts: [] }, 503);
  }
});
