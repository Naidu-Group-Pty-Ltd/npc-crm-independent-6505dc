-- Market Updates: stop one masthead dominating the feed, and broaden property coverage.
--
-- The Guardian was 22 of 72 published updates (30.6%) — more than three times the next
-- source. The cause was its feed list: the first entry was https://www.theguardian.com/au/rss,
-- the entire Australian news firehose (politics, sport, culture), and because the source is
-- typed `rss` rather than `rss_multi` the adapter returned that first feed and never read
-- the business feed listed after it. So a general-news firehose was competing hourly with
-- specialist property and lending sources, and winning on volume.
--
-- Retarget it at the two Guardian sections that are actually in scope and let rss_multi
-- merge them. Feeds verified 2026-07-28: business-australia 20 items, housing 20 items.
update public.market_sources
set adapter_type = 'rss_multi',
    feed_urls = jsonb_build_array(
      'https://www.theguardian.com/australia-news/business-australia/rss',
      'https://www.theguardian.com/australia-news/housing/rss'
    ),
    listing_urls = jsonb_build_array('https://www.theguardian.com/australia-news/business-australia'),
    description = 'Guardian Australia business and housing coverage.',
    default_segments = '["economic","property","rental","policy_regulation","political"]'::jsonb,
    refresh_frequency_minutes = 120,
    updated_at = now()
where source_key = 'guardian_australia';

-- Two additions, both fetched and parsed through the ingestion adapter's own logic before
-- being registered. The Conversation is Creative Commons licensed and written by named
-- academics, which suits a client-facing advisory surface; Master Builders covers the
-- construction-supply side that the registry was thin on.
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
    "source_key": "the_conversation_au",
    "name": "The Conversation Australia",
    "description": "Academic analysis of housing, lending and economic policy, written by named researchers under a Creative Commons licence.",
    "adapter_type": "rss",
    "primary_url": "https://theconversation.com/au/business",
    "feed_urls": ["https://theconversation.com/au/business/articles.atom"],
    "listing_urls": ["https://theconversation.com/au/business"],
    "source_authority": "academic_research",
    "reliability_tier": "industry",
    "default_segments": ["economic","property","finance","policy_regulation","social"],
    "category": "economy",
    "refresh_frequency_minutes": 180,
    "copyright_mode": "creative_commons_attribution_excerpt_and_summary",
    "perspective": "academic_analysis"
  },
  {
    "source_key": "master_builders_australia",
    "name": "Master Builders Australia",
    "description": "Construction industry association — housing supply, building costs, labour and planning reform.",
    "adapter_type": "rss",
    "primary_url": "https://masterbuilders.com.au/",
    "feed_urls": ["https://masterbuilders.com.au/feed/"],
    "listing_urls": ["https://masterbuilders.com.au/media-releases"],
    "source_authority": "industry_association",
    "reliability_tier": "industry",
    "default_segments": ["construction","property","policy_regulation","economic"],
    "category": "construction",
    "refresh_frequency_minutes": 240,
    "copyright_mode": "metadata_and_transformative_summary_only",
    "perspective": "construction_industry_advocacy"
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
  default_segments = excluded.default_segments,
  category = excluded.category,
  refresh_frequency_minutes = excluded.refresh_frequency_minutes,
  copyright_mode = excluded.copyright_mode,
  perspective = excluded.perspective,
  registry_status = 'canonical',
  updated_at = now();

-- Rejected after testing on 2026-07-28, recorded so they are not re-attempted:
--   ahuri.edu.au/rss.xml            — 555-byte response, not parseable as RSS.
--   hia.com.au/rss                  — 404.
--   smartpropertyinvestment.com.au  — 404 on /feed.
--   realestatebusiness.com.au       — 404 on /feed.
--   apimagazine.com.au/feed         — 403.
--   infrastructureaustralia.gov.au  — connection reset.
--   grattan.edu.au/feed             — parses, but the output is mostly health, disability
--                                     and energy policy; too little housing to justify.
--   propertyupdate.com.au/feed      — parses, but mixes market commentary with personal
--                                     -development and marketing posts.
--   theconversation.com/au/topics/housing-affordability-1341 — the topic ID returns court
--                                     and family-violence articles, not housing.

-- Master Builders is registered on its apex domain: www.masterbuilders.com.au redirects
-- to the apex, and sourceDomains() only allows a host or its subdomains, so registering
-- the www host makes boundedFetch reject the redirect target it was sent to.
