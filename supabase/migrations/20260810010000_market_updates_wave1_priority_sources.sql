-- Market Updates — Wave 1 priority source expansion.
--
-- Every endpoint below was fetched live on 2026-08-01 and parsed through a faithful port
-- of the ingestion adapter's own logic (anchor-pattern safety rules included) before any
-- source was enabled. Item counts in the comments are from that run. Sources that could
-- not be made to yield real article metadata are registered but left disabled with an
-- exact disabled_reason rather than enabled on the strength of an HTTP 200.
--
-- Anchor patterns must satisfy isSafeAnchorPattern in adapters/anchorPatterns.ts:
-- at most 128 characters, at most ONE unbounded quantifier (+, *, {n,}), no lookarounds.
-- compileAnchorPatterns drops failures silently, so an unsafe pattern yields zero items.
-- Bounded {n,m} repetitions are not counted as unbounded, which is how these stay legal.
--
-- Several listing pages return one junk match from the default `article` selector sweep
-- ("Latest articles"), and because HtmlListingAdapter only runs the anchor fallback when
-- the earlier steps produced nothing, that single hit suppressed extraction entirely.
-- Those sources set item_selector to a deliberately unmatchable value so the anchor step
-- runs. CBA went from 1 junk item to 6 real ones this way.
--
-- NOTE: market_sources_refresh_frequency_minutes_check enforces a 15-minute floor, so the
-- 10-minute cadence requested for the licensed newswires is clamped to 15. That is the
-- schema's guard against hammering an origin, and licensed feeds are disabled anyway.
--
-- ROLLBACK: this migration only upserts by source_key and never deletes. To revert, set
-- enabled = false for the source_keys added here; the pre-existing 23-source registry is
-- untouched except where a repair is explicitly noted.

-- ---------------------------------------------------------------------------
-- 1. Sources verified live and enabled
-- ---------------------------------------------------------------------------
insert into public.market_sources (
  source_key, name, description, source_type, url, category, geography, reliability_tier,
  enabled, adapter_type, primary_url, feed_urls, listing_urls, source_authority,
  default_segments, refresh_frequency_minutes, copyright_mode, perspective,
  adapter_config, extraction_policy, registry_status, legal_storage_policy, health_status
)
select
  x.source_key, x.name, x.description, x.adapter_type, x.primary_url, x.category, 'Australia',
  x.reliability_tier, true, x.adapter_type, x.primary_url, x.feed_urls, x.listing_urls,
  x.source_authority, x.default_segments, x.refresh_frequency_minutes, x.copyright_mode,
  x.perspective, x.adapter_config, '{"metadata_only":true,"full_article":false}'::jsonb,
  'canonical', 'metadata_excerpt_transformative_summary', 'healthy'
from jsonb_to_recordset('[
  {
    "source_key": "australian_bureau_statistics",
    "name": "Australian Bureau of Statistics",
    "description": "Official Australian statistics covering inflation, employment, lending, dwelling approvals, construction and population.",
    "adapter_type": "html_listing",
    "primary_url": "https://www.abs.gov.au/media-centre/media-releases",
    "feed_urls": [],
    "listing_urls": ["https://www.abs.gov.au/media-centre/media-releases"],
    "source_authority": "official_statistics",
    "reliability_tier": "official",
    "default_segments": ["economic","finance","property","construction","rental","policy_regulation"],
    "category": "economy",
    "refresh_frequency_minutes": 60,
    "copyright_mode": "public_sector_metadata_and_summary",
    "perspective": null,
    "adapter_config": {"item_selector":"__anchor_only__","anchor_patterns":["^/media-centre/media-releases/[a-z0-9-]+$"],"title_min_length":12}
  },
  {
    "source_key": "australian_treasury",
    "name": "Australian Treasury",
    "description": "Departmental media releases and consultations on housing, tax, the financial system and economic policy.",
    "adapter_type": "html_listing",
    "primary_url": "https://treasury.gov.au/media-release",
    "feed_urls": [],
    "listing_urls": ["https://treasury.gov.au/media-release","https://treasury.gov.au/consultation"],
    "source_authority": "primary_government",
    "reliability_tier": "official",
    "default_segments": ["economic","finance","property","policy_regulation"],
    "category": "policy_regulation",
    "refresh_frequency_minutes": 90,
    "copyright_mode": "public_sector_metadata_and_summary",
    "perspective": null,
    "adapter_config": {"item_selector":"__anchor_only__","anchor_patterns":["^/media-release/[a-z0-9-]+$","^/consultation/c[0-9-]{4,20}$"],"title_min_length":12}
  },
  {
    "source_key": "treasury_ministers_priority",
    "name": "Australian Treasury Ministers",
    "description": "Ministerial releases on the economy, housing, taxation, banking and financial-services policy.",
    "adapter_type": "rss_with_html_fallback",
    "primary_url": "https://ministers.treasury.gov.au/",
    "feed_urls": ["https://ministers.treasury.gov.au/ministers/jim-chalmers-2022/media-releases/feed"],
    "listing_urls": ["https://ministers.treasury.gov.au/ministers/jim-chalmers-2022/media-releases"],
    "source_authority": "primary_government",
    "reliability_tier": "official",
    "default_segments": ["economic","property","finance","policy_regulation","construction"],
    "category": "policy_regulation",
    "refresh_frequency_minutes": 90,
    "copyright_mode": "public_sector_metadata_and_summary",
    "perspective": "government_policy",
    "adapter_config": {}
  },
  {
    "source_key": "national_housing_supply_affordability_council",
    "name": "National Housing Supply and Affordability Council",
    "description": "Independent statutory housing-system assessments, supply forecasts and affordability analysis.",
    "adapter_type": "html_listing",
    "primary_url": "https://nhsac.gov.au/",
    "feed_urls": [],
    "listing_urls": ["https://nhsac.gov.au/"],
    "source_authority": "independent_statutory_research",
    "reliability_tier": "official",
    "default_segments": ["property","rental","construction","economic","policy_regulation","social"],
    "category": "property_market",
    "refresh_frequency_minutes": 240,
    "copyright_mode": "public_sector_metadata_and_summary",
    "perspective": "independent_housing_analysis",
    "adapter_config": {"item_selector":"__anchor_only__","anchor_patterns":["^/reports-and-submissions/[a-z0-9-]+$"],"title_min_length":12}
  },
  {
    "source_key": "commonwealth_bank_economics",
    "name": "Commonwealth Bank Economics",
    "description": "CBA economic, household, property and interest-rate research.",
    "adapter_type": "html_listing",
    "primary_url": "https://www.commbank.com.au/newsroom/latest-economic-news-and-analysis.html",
    "feed_urls": [],
    "listing_urls": ["https://www.commbank.com.au/newsroom/latest-economic-news-and-analysis.html"],
    "source_authority": "bank_research",
    "reliability_tier": "institutional_research",
    "default_segments": ["economic","finance","property","construction"],
    "category": "economy",
    "refresh_frequency_minutes": 120,
    "copyright_mode": "metadata_and_transformative_summary_only",
    "perspective": "bank_forecast",
    "adapter_config": {"item_selector":"__anchor_only__","anchor_patterns":["^/articles/newsroom/[0-9]{4}/[a-zA-Z]{3,9}/[a-z0-9-]+.html$"],"title_min_length":12}
  },
  {
    "source_key": "westpac_iq_economics",
    "name": "Westpac IQ Economics",
    "description": "Westpac economic, housing, consumer-sentiment and rates research.",
    "adapter_type": "html_listing",
    "primary_url": "https://www.westpaciq.com.au/economics.html",
    "feed_urls": [],
    "listing_urls": ["https://www.westpaciq.com.au/economics.html"],
    "source_authority": "bank_research",
    "reliability_tier": "institutional_research",
    "default_segments": ["economic","finance","property"],
    "category": "economy",
    "refresh_frequency_minutes": 120,
    "copyright_mode": "metadata_and_transformative_summary_only",
    "perspective": "bank_forecast",
    "adapter_config": {"item_selector":"__anchor_only__","anchor_patterns":["^/economics/[0-9]{4}/[0-9]{2}/[a-zA-Z0-9-]+$"],"title_min_length":12}
  },
  {
    "source_key": "anz_institutional_insights",
    "name": "ANZ Institutional Insights",
    "description": "ANZ institutional economic, rates, trade and property analysis.",
    "adapter_type": "html_listing",
    "primary_url": "https://www.anz.com/institutional/insights/",
    "feed_urls": [],
    "listing_urls": ["https://www.anz.com/institutional/insights/"],
    "source_authority": "bank_research",
    "reliability_tier": "institutional_research",
    "default_segments": ["economic","finance","property","international"],
    "category": "economy",
    "refresh_frequency_minutes": 180,
    "copyright_mode": "metadata_and_transformative_summary_only",
    "perspective": "bank_forecast",
    "adapter_config": {"anchor_patterns":["^/institutional/insights/articles/[0-9]{4}/[0-9]{2}/[a-z0-9-]+/$"],"title_min_length":12}
  }
]'::jsonb) as x(
  source_key text, name text, description text, adapter_type text, primary_url text,
  feed_urls jsonb, listing_urls jsonb, source_authority text, reliability_tier text,
  default_segments jsonb, category text, refresh_frequency_minutes int,
  copyright_mode text, perspective text, adapter_config jsonb
)
on conflict (source_key) where source_key is not null do update set
  name = excluded.name, description = excluded.description,
  adapter_type = excluded.adapter_type, primary_url = excluded.primary_url,
  feed_urls = excluded.feed_urls, listing_urls = excluded.listing_urls,
  source_authority = excluded.source_authority, reliability_tier = excluded.reliability_tier,
  default_segments = excluded.default_segments, category = excluded.category,
  refresh_frequency_minutes = excluded.refresh_frequency_minutes,
  copyright_mode = excluded.copyright_mode, perspective = excluded.perspective,
  adapter_config = excluded.adapter_config, registry_status = 'canonical',
  extraction_policy = excluded.extraction_policy,
  legal_storage_policy = excluded.legal_storage_policy,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- 2. Registered but disabled — verified non-viable, with the exact reason
-- ---------------------------------------------------------------------------
insert into public.market_sources (
  source_key, name, description, source_type, url, category, geography, reliability_tier,
  enabled, adapter_type, primary_url, feed_urls, listing_urls, source_authority,
  default_segments, refresh_frequency_minutes, copyright_mode, perspective,
  adapter_config, extraction_policy, registry_status, legal_storage_policy,
  health_status, disabled_reason
)
select
  x.source_key, x.name, x.description, x.adapter_type, x.primary_url, x.category, 'Australia',
  x.reliability_tier, false, x.adapter_type, x.primary_url, x.feed_urls, x.listing_urls,
  x.source_authority, x.default_segments, x.refresh_frequency_minutes, x.copyright_mode,
  x.perspective, '{}'::jsonb, '{"metadata_only":true,"full_article":false}'::jsonb,
  'canonical', 'metadata_excerpt_transformative_summary', 'disabled', x.disabled_reason
from jsonb_to_recordset('[
  {
    "source_key": "asic_newsroom",
    "name": "Australian Securities and Investments Commission",
    "description": "ASIC announcements on financial services, lending conduct, enforcement and consumer protection.",
    "adapter_type": "html_listing",
    "primary_url": "https://www.asic.gov.au/newsroom/",
    "feed_urls": [],
    "listing_urls": ["https://www.asic.gov.au/newsroom/"],
    "source_authority": "regulator",
    "reliability_tier": "official",
    "default_segments": ["finance","policy_regulation","economic"],
    "category": "policy_regulation",
    "refresh_frequency_minutes": 120,
    "copyright_mode": "public_sector_metadata_and_summary",
    "perspective": null,
    "disabled_reason": "Newsroom links only section indexes and the media-release listing is a 14KB client-rendered shell; no JSON-LD, no article anchors, zero items under a valid pattern. Needs a server-side data source, not a selector change."
  },
  {
    "source_key": "nab_economics_market_news",
    "name": "NAB Economics and Market News",
    "description": "NAB economic, housing, business and monetary-policy research.",
    "adapter_type": "rss_with_html_fallback",
    "primary_url": "https://news.nab.com.au/",
    "feed_urls": ["https://news.nab.com.au/feed/"],
    "listing_urls": ["https://news.nab.com.au/tag/economic-market"],
    "source_authority": "bank_research",
    "reliability_tier": "institutional_research",
    "default_segments": ["economic","finance","property","construction"],
    "category": "economy",
    "refresh_frequency_minutes": 120,
    "copyright_mode": "metadata_and_transformative_summary_only",
    "perspective": "bank_forecast",
    "disabled_reason": "news.nab.com.au/feed/ returns HTTP 404; no working RSS endpoint found. Re-enable if NAB publishes a stable economics feed."
  },
  {
    "source_key": "australian_financial_review",
    "name": "Australian Financial Review",
    "description": "Premium Australian business, property, banking and economic journalism.",
    "adapter_type": "licensed_api",
    "primary_url": "https://business.afr.com/content-integrations",
    "feed_urls": [],
    "listing_urls": [],
    "source_authority": "tier_1_premium_business_media",
    "reliability_tier": "tier_1_media",
    "default_segments": ["economic","finance","property","policy_regulation"],
    "category": "economy",
    "refresh_frequency_minutes": 15,
    "copyright_mode": "licensed_content_only",
    "perspective": "premium_business_media",
    "disabled_reason": "Licence pending. Requires AFR_CONTENT_API_BASE_URL, AFR_CONTENT_API_KEY, AFR_CONTENT_API_CLIENT_ID and AFR_CONTENT_INTEGRATION_ENABLED plus written redistribution rights. Scraping afr.com is not an acceptable fallback."
  },
  {
    "source_key": "bloomberg_australia",
    "name": "Bloomberg Australia and Global Macro",
    "description": "Licensed Bloomberg coverage of central banks, rates, currencies and property-related markets.",
    "adapter_type": "licensed_api",
    "primary_url": "https://professional.bloomberg.com/products/data/enterprise-catalog/event-driven-feeds/",
    "feed_urls": [],
    "listing_urls": [],
    "source_authority": "global_tier_1_financial_media",
    "reliability_tier": "tier_1_media",
    "default_segments": ["economic","finance","property","international","policy_regulation"],
    "category": "economy",
    "refresh_frequency_minutes": 15,
    "copyright_mode": "licensed_content_only",
    "perspective": "global_financial_media",
    "disabled_reason": "Licence pending. Requires BLOOMBERG_TEXTUAL_NEWS_ENDPOINT, BLOOMBERG_CLIENT_ID, BLOOMBERG_CLIENT_SECRET and BLOOMBERG_CONTENT_ENABLED. Scraping bloomberg.com is not an acceptable fallback."
  }
]'::jsonb) as x(
  source_key text, name text, description text, adapter_type text, primary_url text,
  feed_urls jsonb, listing_urls jsonb, source_authority text, reliability_tier text,
  default_segments jsonb, category text, refresh_frequency_minutes int,
  copyright_mode text, perspective text, disabled_reason text
)
on conflict (source_key) where source_key is not null do update set
  name = excluded.name, description = excluded.description,
  adapter_type = excluded.adapter_type, primary_url = excluded.primary_url,
  source_authority = excluded.source_authority,
  default_segments = excluded.default_segments,
  copyright_mode = excluded.copyright_mode,
  disabled_reason = excluded.disabled_reason,
  registry_status = 'canonical',
  updated_at = now();

-- ---------------------------------------------------------------------------
-- 3. Repairs to existing records — no duplicates created
-- ---------------------------------------------------------------------------

-- Reuters is already registered. Convert it from a scraping configuration to a licensed
-- provider record so nothing attempts to fetch reuters.com. It stays disabled.
update public.market_sources
set adapter_type = 'licensed_api',
    primary_url = 'https://reutersagency.com/content-delivery-platforms/content-delivery',
    feed_urls = '[]'::jsonb,
    listing_urls = '[]'::jsonb,
    source_authority = 'global_tier_1_newswire',
    copyright_mode = 'licensed_content_only',
    perspective = 'global_newswire',
    enabled = false,
    health_status = 'disabled',
    consecutive_failures = 0,
    last_error = null,
    disabled_reason = 'Licence pending. Requires REUTERS_CONTENT_API_URL, REUTERS_CONTENT_API_KEY, REUTERS_CONTENT_FEED_URL and REUTERS_CONTENT_ENABLED. Reuters publishes no public RSS for this use; the previous HTTP 401 was the paywall, not a misconfiguration.',
    updated_at = now()
where source_key = 'reuters_australia';

-- RBA: retested 2026-08-01 from the database egress — still HTTP 403 (Akamai "Access
-- Denied"). This confirms the finding recorded in
-- docs/MARKET_UPDATES_SCHEMA_DRIFT_INVESTIGATION_2026-07-28.md: the block follows the
-- egress region of internal invocations, so an in-project relay is blocked identically
-- to the caller. supabase/functions/market-source-relay is written and tested for this
-- purpose but must be hosted off Supabase to help. Feed list is updated to the full
-- five-feed set (fsr and smp verified live) so that re-enabling is a one-field change.
update public.market_sources
set adapter_type = 'rss_multi',
    feed_urls = jsonb_build_array(
      'https://www.rba.gov.au/rss/rss-cb-media-releases.xml',
      'https://www.rba.gov.au/rss/rss-cb-speeches.xml',
      'https://www.rba.gov.au/rss/rss-cb-bulletin.xml',
      'https://www.rba.gov.au/rss/rss-cb-fsr.xml',
      'https://www.rba.gov.au/rss/rss-cb-smp.xml'
    ),
    listing_urls = jsonb_build_array(
      'https://www.rba.gov.au/media-releases/',
      'https://www.rba.gov.au/speeches/',
      'https://www.rba.gov.au/publications/bulletin/'
    ),
    source_authority = 'primary_government',
    refresh_frequency_minutes = 60,
    enabled = false,
    health_status = 'disabled',
    consecutive_failures = 0,
    disabled_reason = 'RBA CDN returns HTTP 403 to this project''s internal egress (Edge Functions and pg_net alike, every path including /robots.txt); retested 2026-08-01, still blocked. Needs an RBA allow-list for the Supabase ap-southeast-1 ranges, or market-source-relay hosted on non-Supabase infrastructure. All five feeds verified reachable from other networks.',
    updated_at = now()
where source_key = 'reserve_bank_australia';

-- Domain: retested 2026-08-01, https://www.domain.com.au/news/feed/ returns HTTP 403.
-- Left disabled; the existing record is otherwise correct so nothing else changes.
update public.market_sources
set disabled_reason = 'domain.com.au/news/feed/ returns HTTP 403 to automated requests; retested 2026-08-01. Needs a licensed feed or partnership, not a selector change.',
    updated_at = now()
where source_key = 'domain_research' and enabled = false;

-- Cotality is currently healthy and enabled and is deliberately left untouched.

-- ---------------------------------------------------------------------------
-- Verification (run after applying):
--   select source_key, enabled, health_status, left(coalesce(disabled_reason,''),60)
--     from public.market_sources where registry_status='canonical' order by enabled desc, source_key;
--   select count(*) filter (where enabled) as live, count(*) as canonical
--     from public.market_sources where registry_status='canonical';
-- ---------------------------------------------------------------------------
