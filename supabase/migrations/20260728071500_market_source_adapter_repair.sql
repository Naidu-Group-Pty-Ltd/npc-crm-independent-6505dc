-- Market Updates: repair the six canonical sources that returned
-- "Listing layout yielded no public article metadata" on every run.
--
-- Root cause: none of the seeded `anchor_patterns` survive
-- `isSafeAnchorPattern` in adapters/anchorPatterns.ts, so `compileAnchorPatterns`
-- returned an empty list and the anchor fallback never ran. Each pattern broke at
-- least one of the validator's three rules:
--   * The Adviser / Broker Daily — 139 chars (limit is 128) and two unbounded
--     quantifiers (`\d+` and `[a-z0-9-]+`; the limit is one).
--   * Mortgage Professional Australia — two/three unbounded quantifiers.
--   * FBAA — 276 chars and a `(?!...)` lookahead, which the validator rejects outright.
-- With no usable pattern and no `<article>` elements in the (client-rendered) markup,
-- steps 1-3 of HtmlListingAdapter.read all yielded nothing.
--
-- Every replacement below was validated against live markup fetched on 2026-07-28
-- through a faithful port of the adapter's own parsing and pattern-safety code.
--
-- Note: 20260725130000's registry upsert overwrites adapter_type/feed_urls/
-- listing_urls (though not adapter_config). Re-running that seed would revert the
-- adapter routing chosen here.

-- Three sources publish a machine-readable feed, which is more durable than
-- scraping a client-rendered listing. Verified item counts on 2026-07-28:
-- ABC 25, MFAA 12, MPA 36 — all with parseable publication dates.
update public.market_sources
set adapter_type = 'rss',
    feed_urls = '["https://www.abc.net.au/news/feed/51892/rss.xml"]'::jsonb,
    updated_at = now()
where source_key = 'abc_business';

update public.market_sources
set adapter_type = 'rss',
    feed_urls = '["https://www.mfaa.com.au/feed"]'::jsonb,
    updated_at = now()
where source_key = 'mfaa';

-- MPA keeps an HTML fallback because its listing pages do carry article anchors
-- once the pattern is expressible: `/au/{section}/{slug}/{id}` with no unbounded
-- quantifier at all (bounded {n,m} repetitions are not counted by the validator).
update public.market_sources
set adapter_type = 'rss_with_html_fallback',
    feed_urls = '["https://www.mpamag.com/au/rss"]'::jsonb,
    adapter_config = adapter_config || jsonb_build_object(
      'anchor_patterns', '["^/au/[a-z0-9/-]{10,90}/[0-9]{4,8}$"]'::jsonb,
      'title_min_length', 10
    ),
    updated_at = now()
where source_key = 'mortgage_professional_australia';

-- The Adviser and Broker Daily are the same Joomla platform and share a URL shape:
-- /{section}/{id}-{slug}. One unbounded quantifier, 114 chars, no lookaround.
-- HtmlListingAdapter.fetch returns on the first listing URL that yields items, so
-- the richest section is listed first (breaking-news: 20 and 15 items respectively).
update public.market_sources
set listing_urls = '["https://www.theadviser.com.au/breaking-news","https://www.theadviser.com.au/lender","https://www.theadviser.com.au/broker","https://www.theadviser.com.au/"]'::jsonb,
    adapter_config = adapter_config || jsonb_build_object(
      'anchor_patterns', '["^/(lender|regulation|property|economy|breaking-news|broker|borrower|growth|tech|aggregator)/[0-9]{3,8}-[a-z0-9-]+$"]'::jsonb,
      'title_min_length', 10
    ),
    updated_at = now()
where source_key = 'the_adviser_australia';

update public.market_sources
set primary_url = 'https://www.brokerdaily.au/',
    listing_urls = '["https://www.brokerdaily.au/breaking-news","https://www.brokerdaily.au/lender","https://www.brokerdaily.au/economy","https://www.brokerdaily.au/property","https://www.brokerdaily.au/regulation","https://www.brokerdaily.au/"]'::jsonb,
    adapter_config = adapter_config || jsonb_build_object(
      'anchor_patterns', '["^/(lender|regulation|property|economy|breaking-news|broker|borrower|growth|tech|aggregator)/[0-9]{3,8}-[a-z0-9-]+$"]'::jsonb,
      'title_min_length', 10
    ),
    updated_at = now()
where source_key = 'broker_daily';

-- FBAA cannot be repaired: its newshub publishes no first-party articles. Every
-- headline there links to a third-party outlet (theadviser.com.au, brokerdaily.au,
-- mpamag.com, brokernews.com.au and ~20 others), which normaliseUrl rejects as a
-- disallowed source domain, and its sitemap carries only navigation pages. The
-- outlets it aggregates are already canonical sources in their own right.
update public.market_sources
set enabled = false,
    health_status = 'retired',
    consecutive_failures = 0,
    disabled_reason = 'Newshub aggregates third-party outlets and publishes no first-party articles; the outlets it links to are ingested directly.',
    last_error = null,
    updated_at = now()
where source_key = 'fbaa';

-- Clear the degraded state the misconfiguration produced so health reporting
-- reflects the next real fetch rather than the pattern bug.
update public.market_sources
set consecutive_failures = 0,
    health_status = 'healthy',
    last_error = null,
    updated_at = now()
where source_key in (
  'abc_business', 'mfaa', 'mortgage_professional_australia',
  'the_adviser_australia', 'broker_daily'
);
