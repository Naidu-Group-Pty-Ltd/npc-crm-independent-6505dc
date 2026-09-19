-- Market Updates: add lending, rates and credit-policy coverage to the canonical registry.
--
-- The approved 20-source registry contained no rate-setting authority, no prudential
-- regulator and no dedicated lending press: its "finance" sources were three broker
-- trade titles and three industry associations. RBA, APRA and Treasury existed only as
-- legacy rows retired by 20260725130000, so cash-rate decisions, serviceability and
-- lending-criteria movements could not enter the feed at all. Of 48 published updates,
-- 3 had rate-related titles and 1 mentioned lending criteria.
--
-- Every feed below was fetched and parsed through the ingestion adapter's own logic on
-- 2026-07-28 before being added; item counts are from that run. Sources whose feeds are
-- unusable or duplicated are deliberately excluded and listed at the end of this file.

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
  x.perspective, '{}'::jsonb, '{"metadata_only":true,"full_article":false}'::jsonb,
  'canonical', 'metadata_excerpt_transformative_summary', 'healthy'
from jsonb_to_recordset('[
  {
    "source_key": "reserve_bank_australia",
    "name": "Reserve Bank of Australia",
    "description": "RBA media releases, speeches and Bulletin research — cash rate decisions and monetary policy guidance.",
    "adapter_type": "rss_multi",
    "primary_url": "https://www.rba.gov.au/media-releases/",
    "feed_urls": ["https://www.rba.gov.au/rss/rss-cb-media-releases.xml","https://www.rba.gov.au/rss/rss-cb-speeches.xml","https://www.rba.gov.au/rss/rss-cb-bulletin.xml"],
    "listing_urls": ["https://www.rba.gov.au/media-releases/"],
    "source_authority": "primary_government",
    "reliability_tier": "official",
    "default_segments": ["finance","economic","policy_regulation","property"],
    "category": "finance",
    "refresh_frequency_minutes": 60,
    "copyright_mode": "public_sector_metadata_and_summary",
    "perspective": null
  },
  {
    "source_key": "apra_news",
    "name": "Australian Prudential Regulation Authority",
    "description": "APRA media releases and statistics — prudential standards, serviceability buffers and ADI lending data.",
    "adapter_type": "rss",
    "primary_url": "https://www.apra.gov.au/news-and-publications",
    "feed_urls": ["https://www.apra.gov.au/rss.xml"],
    "listing_urls": ["https://www.apra.gov.au/news-and-publications"],
    "source_authority": "regulator",
    "reliability_tier": "official",
    "default_segments": ["finance","policy_regulation","economic","property"],
    "category": "policy_regulation",
    "refresh_frequency_minutes": 90,
    "copyright_mode": "public_sector_metadata_and_summary",
    "perspective": null
  },
  {
    "source_key": "australian_broker",
    "name": "Australian Broker",
    "description": "Australian Broker (Key Media) — mortgage broking, lender policy and lending criteria news.",
    "adapter_type": "rss",
    "primary_url": "https://www.brokernews.com.au/",
    "feed_urls": ["https://www.brokernews.com.au/rss"],
    "listing_urls": ["https://www.brokernews.com.au/news"],
    "source_authority": "specialist_industry_media",
    "reliability_tier": "industry",
    "default_segments": ["finance","property","policy_regulation","economic"],
    "category": "finance",
    "refresh_frequency_minutes": 60,
    "copyright_mode": "metadata_and_transformative_summary_only",
    "perspective": null
  },
  {
    "source_key": "your_mortgage",
    "name": "Your Mortgage",
    "description": "Your Mortgage (Key Media) — home loan products, rate movements and borrower-facing lending guidance.",
    "adapter_type": "rss",
    "primary_url": "https://www.yourmortgage.com.au/",
    "feed_urls": ["https://www.yourmortgage.com.au/feed"],
    "listing_urls": ["https://www.yourmortgage.com.au/mortgage-news"],
    "source_authority": "specialist_industry_media",
    "reliability_tier": "industry",
    "default_segments": ["finance","property","economic"],
    "category": "finance",
    "refresh_frequency_minutes": 120,
    "copyright_mode": "metadata_and_transformative_summary_only",
    "perspective": null
  },
  {
    "source_key": "savings_com_au",
    "name": "Savings.com.au",
    "description": "Savings.com.au — home loan and deposit rate movements, lender policy changes and credit conditions.",
    "adapter_type": "rss",
    "primary_url": "https://www.savings.com.au/",
    "feed_urls": ["https://www.savings.com.au/feed"],
    "listing_urls": ["https://www.savings.com.au/news"],
    "source_authority": "specialist_industry_media",
    "reliability_tier": "industry",
    "default_segments": ["finance","property","economic"],
    "category": "finance",
    "refresh_frequency_minutes": 90,
    "copyright_mode": "metadata_and_transformative_summary_only",
    "perspective": null
  },
  {
    "source_key": "infochoice",
    "name": "InfoChoice",
    "description": "InfoChoice — comparison-desk coverage of home loan rates, fixed vs variable and lender repricing.",
    "adapter_type": "rss",
    "primary_url": "https://www.infochoice.com.au/",
    "feed_urls": ["https://www.infochoice.com.au/feed"],
    "listing_urls": ["https://www.infochoice.com.au/news"],
    "source_authority": "specialist_industry_media",
    "reliability_tier": "industry",
    "default_segments": ["finance","property","economic"],
    "category": "finance",
    "refresh_frequency_minutes": 120,
    "copyright_mode": "metadata_and_transformative_summary_only",
    "perspective": null
  },
  {
    "source_key": "customer_owned_banking",
    "name": "Customer Owned Banking Association",
    "description": "COBA — mutual bank and credit union sector positions on lending policy and competition.",
    "adapter_type": "rss",
    "primary_url": "https://www.customerownedbanking.asn.au/",
    "feed_urls": ["https://www.coba.asn.au/feed/"],
    "listing_urls": ["https://www.customerownedbanking.asn.au/"],
    "source_authority": "industry_association",
    "reliability_tier": "industry",
    "default_segments": ["finance","policy_regulation","economic"],
    "category": "finance",
    "refresh_frequency_minutes": 240,
    "copyright_mode": "metadata_and_transformative_summary_only",
    "perspective": "mutual_banking_advocacy"
  },
  {
    "source_key": "afg_online",
    "name": "Australian Finance Group",
    "description": "AFG — aggregator lodgement data and the AFG Mortgage Index on borrowing patterns and lender share.",
    "adapter_type": "rss",
    "primary_url": "https://afgonline.com.au/",
    "feed_urls": ["https://afgonline.com.au/feed/"],
    "listing_urls": ["https://afgonline.com.au/news/"],
    "source_authority": "specialist_data",
    "reliability_tier": "industry",
    "default_segments": ["finance","property","economic"],
    "category": "finance",
    "refresh_frequency_minutes": 240,
    "copyright_mode": "metadata_and_transformative_summary_only",
    "perspective": "aggregator_industry"
  },
  {
    "source_key": "firstlinks",
    "name": "Firstlinks",
    "description": "Firstlinks (Morningstar Australia) — investment, superannuation and tax-policy commentary affecting borrowers.",
    "adapter_type": "rss",
    "primary_url": "https://www.firstlinks.com.au/",
    "feed_urls": ["https://www.firstlinks.com.au/feed"],
    "listing_urls": ["https://www.firstlinks.com.au/"],
    "source_authority": "specialist_industry_media",
    "reliability_tier": "industry",
    "default_segments": ["finance","economic","policy_regulation","property"],
    "category": "finance",
    "refresh_frequency_minutes": 240,
    "copyright_mode": "metadata_and_transformative_summary_only",
    "perspective": "investment_commentary"
  },
  {
    "source_key": "finder_au",
    "name": "Finder",
    "description": "Finder — comparison coverage of home loan rates, lender offers and household borrowing costs.",
    "adapter_type": "rss",
    "primary_url": "https://www.finder.com.au/",
    "feed_urls": ["https://www.finder.com.au/feed"],
    "listing_urls": ["https://www.finder.com.au/news"],
    "source_authority": "specialist_industry_media",
    "reliability_tier": "watchlist",
    "default_segments": ["finance","property","economic"],
    "category": "finance",
    "refresh_frequency_minutes": 240,
    "copyright_mode": "metadata_and_transformative_summary_only",
    "perspective": "comparison_service"
  }
]'::jsonb) as x(
  source_key text, name text, description text, adapter_type text, primary_url text,
  feed_urls jsonb, listing_urls jsonb, source_authority text, reliability_tier text,
  default_segments jsonb, category text, refresh_frequency_minutes int,
  copyright_mode text, perspective text
)
on conflict (source_key) where source_key is not null do update set
  name = excluded.name,
  description = excluded.description,
  adapter_type = excluded.adapter_type,
  primary_url = excluded.primary_url,
  feed_urls = excluded.feed_urls,
  listing_urls = excluded.listing_urls,
  source_authority = excluded.source_authority,
  reliability_tier = excluded.reliability_tier,
  default_segments = excluded.default_segments,
  category = excluded.category,
  refresh_frequency_minutes = excluded.refresh_frequency_minutes,
  copyright_mode = excluded.copyright_mode,
  perspective = excluded.perspective,
  registry_status = 'canonical',
  updated_at = now();

-- Deliberately excluded after testing on 2026-07-28:
--   mortgagebusiness.com.au  — byte-for-byte identical to the existing Broker Daily
--                              source (same Momentum Media site), so it would only
--                              duplicate rows.
--   asic.gov.au              — newsroom and media-release listings are client-rendered
--                              and expose no feed; the pages return no article anchors.
--   ministers.treasury.gov.au— feed is stale (newest entry 2023) and carries navigation
--                              entries such as "Home" as items.
--   canstar / ratecity / mozo— no feed endpoint; listings sit behind bot protection.
--   loanmarket.com.au        — brokerage marketing pages rather than lending news.
--   macrobusiness.com.au     — partisan commentary, unsuitable for client-facing advice.
--
-- AFG is registered on its apex domain: www.afgonline.com.au redirects to the apex,
-- and sourceDomains() only allows a host or its subdomains, so registering the www
-- host would make boundedFetch reject its own redirect target.

-- The RBA origin returns HTTP 403 to the Edge Function egress on every attempt while
-- serving the same feeds normally from other networks, so its row is registered but
-- left disabled rather than failing hourly and dragging source health down. Re-enable
-- once the egress is allow-listed by the RBA or the fetch is routed through a proxy;
-- no other change is needed. RBA cash-rate decisions still reach the feed indirectly
-- through Australian Broker, Savings.com.au, InfoChoice and Your Mortgage.
update public.market_sources
set enabled = false,
    health_status = 'disabled',
    consecutive_failures = 0,
    disabled_reason = 'RBA origin returns HTTP 403 to the ingestion egress; needs an allow-listed egress or a proxied fetch.',
    updated_at = now()
where source_key = 'reserve_bank_australia';
