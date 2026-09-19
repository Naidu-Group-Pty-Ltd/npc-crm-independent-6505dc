// Fetch relay for market sources whose origin CDN blocks this project's egress region.
//
// NOT CURRENTLY DEPLOYED — deploying it to Supabase does not help, and it is kept here
// ready to host elsewhere. Testing on 2026-07-28 showed rba.gov.au returns 200 to an Edge
// Function invoked from outside Supabase but upstream 403 to the identical function
// invoked from pg_net or from another function. The block follows the egress region of
// internal invocations (this project is ap-southeast-1), which is the region both
// automated paths use, so an in-project relay is blocked exactly like the caller is.
//
// To make RBA work, host this on infrastructure the RBA does not block — an
// Australian-region Cloudflare Worker is the natural fit given the project already uses
// Cloudflare — then point market_sources.feed_urls for reserve_bank_australia at it. The
// alternative is to have the RBA allow-list Supabase's ap-southeast-1 egress ranges, in
// which case this relay is unnecessary and feed_urls go straight back to rba.gov.au.
//
// It is NOT an open proxy: it will only fetch URLs on a hardcoded allow-list, only over
// GET, and it returns the upstream body verbatim so the RSS adapter parses it unchanged.

const ALLOWED_URLS = new Set([
  'https://www.rba.gov.au/rss/rss-cb-media-releases.xml',
  'https://www.rba.gov.au/rss/rss-cb-speeches.xml',
  'https://www.rba.gov.au/rss/rss-cb-bulletin.xml',
]);

const UPSTREAM_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

Deno.serve(async (req) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405,
      headers: { 'content-type': 'application/json', allow: 'GET, HEAD' },
    });
  }

  const target = new URL(req.url).searchParams.get('url') ?? '';
  if (!ALLOWED_URLS.has(target)) {
    return new Response(JSON.stringify({ error: 'url_not_allowed' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const upstream = await fetch(target, {
      headers: {
        'user-agent': UPSTREAM_UA,
        accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5',
        'accept-language': 'en-AU,en;q=0.9',
      },
      signal: controller.signal,
    });
    const body = await upstream.text();
    if (!upstream.ok) {
      return new Response(JSON.stringify({ error: 'upstream_failed', status: upstream.status }), {
        status: 502,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(body, {
      status: 200,
      headers: {
        'content-type': upstream.headers.get('content-type') ?? 'application/xml; charset=utf-8',
        'cache-control': 'public, max-age=300',
      },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'upstream_unreachable' }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    });
  } finally {
    clearTimeout(timer);
  }
});
