-- Market Updates — Wave 1 priority source expansion.
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
  {"source_key": "australian_bureau_statistics", "name": "Australian Bureau of Statistics", "description": "Official Australian statistics covering inflation, employment, lending, dwelling approvals, construction and population.", "adapter_type": "html_listing", "primary_url": "https://www.abs.gov.au/media-centre/media-releases", "feed_urls": [], "listing_urls": ["https://www.abs.gov.au/media-centre/media-releases"], "source_authority": "official_statistics", "reliability_tier": "official", "default_segments": ["economic","finance","property","construction","rental","policy_regulation"], "category": "economy", "refresh_frequency_minutes": 60, "copyright_mode": "public_sector_metadata_and_summary", "perspective": null, "adapter_config": {"item_selector":"__anchor_only__","anchor_patterns":["^/media-centre/media-releases/[a-z0-9-]+$"],"title_min_length":12}},
  {"source_key": "australian_treasury", "name": "Australian Treasury", "description": "Departmental media releases and consultations on housing, tax, the financial system and economic policy.", "adapter_type": "html_listing", "primary_url": "https://treasury.gov.au/media-release", "feed_urls": [], "listing_urls": ["https://treasury.gov.au/media-release","https://treasury.gov.au/consultation"], "source_authority": "primary_government", "reliability_tier": "official", "default_segments": ["economic","finance","property","policy_regulation"], "category": "policy_regulation", "refresh_frequency_minutes": 90, "copyright_mode": "public_sector_metadata_and_summary", "perspective": null, "adapter_config": {"item_selector":"__anchor_only__","anchor_patterns":["^/media-release/[a-z0-9-]+$","^/consultation/c[0-9-]{4,20}$"],"title_min_length":12}},
  {"source_key": "treasury_ministers_priority", "name": "Australian Treasury Ministers", "description": "Ministerial releases on the economy, housing, taxation, banking and financial-services policy.", "adapter_type": "rss_with_html_fallback", "primary_url": "https://ministers.treasury.gov.au/", "feed_urls": ["https://ministers.treasury.gov.au/ministers/jim-chalmers-2022/media-releases/feed"], "listing_urls": ["https://ministers.treasury.gov.au/ministers/jim-chalmers-2022/media-releases"], "source_authority": "primary_government", "reliability_tier": "official", "default_segments": ["economic","property","finance","policy_regulation","construction"], "category": "policy_regulation", "refresh_frequency_minutes": 90, "copyright_mode": "public_sector_metadata_and_summary", "perspective": "government_policy", "adapter_config": {}},
  {"source_key": "national_housing_supply_affordability_council", "name": "National Housing Supply and Affordability Council", "description": "Independent statutory housing-system assessments, supply forecasts and affordability analysis.", "adapter_type": "html_listing", "primary_url": "https://nhsac.gov.au/", "feed_urls": [], "listing_urls": ["https://nhsac.gov.au/"], "source_authority": "independent_statutory_research", "reliability_tier": "official", "default_segments": ["property","rental","construction","economic","policy_regulation","social"], "category": "property_market", "refresh_frequency_minutes": 240, "copyright_mode": "public_sector_metadata_and_summary", "perspective": "independent_housing_analysis", "adapter_config": {"item_selector":"__anchor_only__","anchor_patterns":["^/reports-and-submissions/[a-z0-9-]+$"],"title_min_length":12}},
  {"source_key": "commonwealth_bank_economics", "name": "Commonwealth Bank Economics", "description": "CBA economic, household, property and interest-rate research.", "adapter_type": "html_listing", "primary_url": "https://www.commbank.com.au/newsroom/latest-economic-news-and-analysis.html", "feed_urls": [], "listing_urls": ["https://www.commbank.com.au/newsroom/latest-economic-news-and-analysis.html"], "source_authority": "bank_research", "reliability_tier": "institutional_research", "default_segments": ["economic","finance","property","construction"], "category": "economy", "refresh_frequency_minutes": 120, "copyright_mode": "metadata_and_transformative_summary_only", "perspective": "bank_forecast", "adapter_config": {"item_selector":"__anchor_only__","anchor_patterns":["^/articles/newsroom/[0-9]{4}/[a-zA-Z]{3,9}/[a-z0-9-]+.html$"],"title_min_length":12}},
  {"source_key": "westpac_iq_economics", "name": "Westpac IQ Economics", "description": "Westpac economic, housing, consumer-sentiment and rates research.", "adapter_type": "html_listing", "primary_url": "https://www.westpaciq.com.au/economics.html", "feed_urls": [], "listing_urls": ["https://www.westpaciq.com.au/economics.html"], "source_authority": "bank_research", "reliability_tier": "institutional_research", "default_segments": ["economic","finance","property"], "category": "economy", "refresh_frequency_minutes": 120, "copyright_mode": "metadata_and_transformative_summary_only", "perspective": "bank_forecast", "adapter_config": {"item_selector":"__anchor_only__","anchor_patterns":["^/economics/[0-9]{4}/[0-9]{2}/[a-zA-Z0-9-]+$"],"title_min_length":12}},
  {"source_key": "anz_institutional_insights", "name": "ANZ Institutional Insights", "description": "ANZ institutional economic, rates, trade and property analysis.", "adapter_type": "html_listing", "primary_url": "https://www.anz.com/institutional/insights/", "feed_urls": [], "listing_urls": ["https://www.anz.com/institutional/insights/"], "source_authority": "bank_research", "reliability_tier": "institutional_research", "default_segments": ["economic","finance","property","international"], "category": "economy", "refresh_frequency_minutes": 180, "copyright_mode": "metadata_and_transformative_summary_only", "perspective": "bank_forecast", "adapter_config": {"anchor_patterns":["^/institutional/insights/articles/[0-9]{4}/[0-9]{2}/[a-z0-9-]+/$"],"title_min_length":12}}
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
  {"source_key": "asic_newsroom", "name": "Australian Securities and Investments Commission", "description": "ASIC announcements on financial services, lending conduct, enforcement and consumer protection.", "adapter_type": "html_listing", "primary_url": "https://www.asic.gov.au/newsroom/", "feed_urls": [], "listing_urls": ["https://www.asic.gov.au/newsroom/"], "source_authority": "regulator", "reliability_tier": "official", "default_segments": ["finance","policy_regulation","economic"], "category": "policy_regulation", "refresh_frequency_minutes": 120, "copyright_mode": "public_sector_metadata_and_summary", "perspective": null, "disabled_reason": "Newsroom links only section indexes and the media-release listing is a 14KB client-rendered shell; no JSON-LD, no article anchors, zero items under a valid pattern. Needs a server-side data source, not a selector change."},
  {"source_key": "nab_economics_market_news", "name": "NAB Economics and Market News", "description": "NAB economic, housing, business and monetary-policy research.", "adapter_type": "rss_with_html_fallback", "primary_url": "https://news.nab.com.au/", "feed_urls": ["https://news.nab.com.au/feed/"], "listing_urls": ["https://news.nab.com.au/tag/economic-market"], "source_authority": "bank_research", "reliability_tier": "institutional_research", "default_segments": ["economic","finance","property","construction"], "category": "economy", "refresh_frequency_minutes": 120, "copyright_mode": "metadata_and_transformative_summary_only", "perspective": "bank_forecast", "disabled_reason": "news.nab.com.au/feed/ returns HTTP 404; no working RSS endpoint found. Re-enable if NAB publishes a stable economics feed."},
  {"source_key": "australian_financial_review", "name": "Australian Financial Review", "description": "Premium Australian business, property, banking and economic journalism.", "adapter_type": "licensed_api", "primary_url": "https://business.afr.com/content-integrations", "feed_urls": [], "listing_urls": [], "source_authority": "tier_1_premium_business_media", "reliability_tier": "tier_1_media", "default_segments": ["economic","finance","property","policy_regulation"], "category": "economy", "refresh_frequency_minutes": 15, "copyright_mode": "licensed_content_only", "perspective": "premium_business_media", "disabled_reason": "Licence pending. Requires AFR_CONTENT_API_BASE_URL, AFR_CONTENT_API_KEY, AFR_CONTENT_API_CLIENT_ID and AFR_CONTENT_INTEGRATION_ENABLED plus written redistribution rights. Scraping afr.com is not an acceptable fallback."},
  {"source_key": "bloomberg_australia", "name": "Bloomberg Australia and Global Macro", "description": "Licensed Bloomberg coverage of central banks, rates, currencies and property-related markets.", "adapter_type": "licensed_api", "primary_url": "https://professional.bloomberg.com/products/data/enterprise-catalog/event-driven-feeds/", "feed_urls": [], "listing_urls": [], "source_authority": "global_tier_1_financial_media", "reliability_tier": "tier_1_media", "default_segments": ["economic","finance","property","international","policy_regulation"], "category": "economy", "refresh_frequency_minutes": 15, "copyright_mode": "licensed_content_only", "perspective": "global_financial_media", "disabled_reason": "Licence pending. Requires BLOOMBERG_TEXTUAL_NEWS_ENDPOINT, BLOOMBERG_CLIENT_ID, BLOOMBERG_CLIENT_SECRET and BLOOMBERG_CONTENT_ENABLED. Scraping bloomberg.com is not an acceptable fallback."}
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
    last_error = null,
    disabled_reason = 'RBA CDN returns HTTP 403 to this project''s internal egress (Edge Functions and pg_net alike, every path including /robots.txt); retested 2026-08-01, still blocked. Needs an RBA allow-list for the Supabase ap-southeast-1 ranges, or market-source-relay hosted on non-Supabase infrastructure. All five feeds verified reachable from other networks.',
    updated_at = now()
where source_key = 'reserve_bank_australia';

update public.market_sources
set disabled_reason = 'domain.com.au/news/feed/ returns HTTP 403 to automated requests; retested 2026-08-01. Needs a licensed feed or partnership, not a selector change.',
    updated_at = now()
where source_key = 'domain_research' and enabled = false;

-- Market Updates: shadow mode.
alter table public.market_sources
  add column if not exists ingest_mode text not null default 'live',
  add column if not exists shadow_since timestamptz,
  add column if not exists shadow_promotion_notes text;

update public.market_sources
set ingest_mode = case when enabled then 'live' else 'disabled' end
where ingest_mode is distinct from (case when enabled then 'live' else 'disabled' end);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'market_sources_ingest_mode_check'
  ) then
    alter table public.market_sources
      add constraint market_sources_ingest_mode_check
      check (ingest_mode in ('live', 'shadow', 'disabled'));
  end if;
end $$;

comment on column public.market_sources.ingest_mode is
  'live = fetched and eligible for publication; shadow = fetched and classified but items are held at visibility=shadow and never published; disabled = not fetched at all.';
comment on column public.market_sources.shadow_since is
  'When the source most recently entered shadow mode. Used to age-out validation windows.';
comment on column public.market_sources.shadow_promotion_notes is
  'What has to be true before this source can be promoted from shadow to live.';

create or replace function public.market_sources_sync_ingest_mode()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.ingest_mode is null then
      new.ingest_mode := case when new.enabled then 'live' else 'disabled' end;
    end if;
    new.enabled := (new.ingest_mode = 'live');
    if new.ingest_mode = 'shadow' and new.shadow_since is null then
      new.shadow_since := now();
    end if;
    return new;
  end if;

  if new.ingest_mode is distinct from old.ingest_mode then
    new.enabled := (new.ingest_mode = 'live');
  elsif new.enabled is distinct from old.enabled then
    new.ingest_mode := case when new.enabled then 'live' else 'disabled' end;
  end if;

  if new.ingest_mode = 'shadow' and old.ingest_mode is distinct from 'shadow' then
    new.shadow_since := now();
  elsif new.ingest_mode <> 'shadow' then
    new.shadow_since := null;
  end if;

  return new;
end $$;

drop trigger if exists trg_market_sources_sync_ingest_mode on public.market_sources;
create trigger trg_market_sources_sync_ingest_mode
  before insert or update on public.market_sources
  for each row execute function public.market_sources_sync_ingest_mode();

create index if not exists idx_market_sources_ingest_mode
  on public.market_sources(ingest_mode, registry_status);

alter table public.market_updates
  add column if not exists visibility text not null default 'public',
  add column if not exists shadow_would_publish boolean;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'market_updates_visibility_check'
  ) then
    alter table public.market_updates
      add constraint market_updates_visibility_check
      check (visibility in ('public', 'shadow'));
  end if;
end $$;

comment on column public.market_updates.visibility is
  'public = eligible for the client feed; shadow = produced by a shadow-mode source and never surfaced to clients.';
comment on column public.market_updates.shadow_would_publish is
  'For shadow rows, whether this item would have been published had the source been live. Null for public rows.';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'market_updates_shadow_not_published_check'
  ) then
    alter table public.market_updates
      add constraint market_updates_shadow_not_published_check
      check (visibility = 'public' or status <> 'published');
  end if;
end $$;

create index if not exists idx_market_updates_visibility_status
  on public.market_updates(visibility, status, source_published_at desc);

create or replace view public.market_shadow_source_metrics
with (security_invoker = true) as
select
  s.id                                            as source_id,
  s.source_key,
  s.name,
  s.ingest_mode,
  s.shadow_since,
  s.shadow_promotion_notes,
  s.health_status,
  s.source_authority,
  s.reliability_tier,
  s.consecutive_failures,
  s.last_error,
  s.last_success_at,
  count(u.id)                                                        as shadow_items,
  count(u.id) filter (where u.shadow_would_publish)                  as would_publish,
  count(u.id) filter (where u.status = 'ignored')                    as below_relevance,
  count(u.id) filter (where u.status = 'rejected')                   as rejected,
  round(avg(u.relevance_score) filter (where u.relevance_score is not null), 1) as avg_relevance,
  round(avg(u.confidence_score) filter (where u.confidence_score is not null), 1) as avg_confidence,
  max(u.ingested_at)                                                 as last_shadow_item_at
from public.market_sources s
left join public.market_updates u
  on u.source_id = s.id
 and u.visibility = 'shadow'
 and (s.shadow_since is null or u.ingested_at >= s.shadow_since)
where s.registry_status = 'canonical'
group by s.id;

comment on view public.market_shadow_source_metrics is
  'Evidence gathered for each shadow-mode source since it entered shadow: how much it discovered, and how much of that would have been published had it been live.';

-- Market Updates: shadow activation.
update public.market_sources
set ingest_mode = 'shadow',
    listing_urls = jsonb_build_array(
      'https://api.prod.legislation.gov.au/swagger/index.html',
      'https://www.legislation.gov.au/'
    ),
    adapter_config = jsonb_build_object(
      'resource', 'Titles',
      'order_by', 'makingDate',
      'fetch_limit', 100,
      'collections', jsonb_build_array('act', 'legislativeinstrument', 'notifiableinstrument'),
      'include_keywords', jsonb_build_array(
        'credit', 'consumer credit', 'banking', 'housing', 'home loan', 'mortgage',
        'lending', 'financial sector', 'superannuation', 'land tax', 'stamp duty',
        'foreign acquisitions', 'first home', 'build-to-rent', 'residential tenanc',
        'property', 'real estate', 'construction', 'building', 'planning',
        'national consumer credit', 'prudential', 'anti-money laundering'
      ),
      'exclude_keywords', jsonb_build_array(
        'pharmaceutical benefits', 'defence determination', 'therapeutic goods',
        'private health insurance', 'disqualification', 'veterans'
      )
    ),
    refresh_frequency_minutes = 360,
    disabled_reason = null,
    shadow_promotion_notes = 'Promote once a shadow window shows the keyword screen is returning property, credit and tax instruments rather than unrelated Commonwealth instruments, and the would-publish rate is non-trivial.',
    last_error = null,
    consecutive_failures = 0,
    health_status = 'degraded',
    updated_at = now()
where source_key = 'federal_register_legislation';

update public.market_sources
set ingest_mode = 'shadow',
    refresh_frequency_minutes = 1440,
    shadow_promotion_notes = 'Promote as soon as a shadow run returns HTTP 200. Blocked on an RBA allow-list for the Supabase ap-southeast-1 egress ranges, or on market-source-relay being hosted off Supabase.',
    updated_at = now()
where source_key = 'reserve_bank_australia';

update public.market_sources
set ingest_mode = 'shadow',
    refresh_frequency_minutes = 1440,
    shadow_promotion_notes = 'Origin returns HTTP 403 to this project''s egress. Promote if a shadow run succeeds; otherwise this needs a licensed feed or a direct arrangement with the publisher.',
    updated_at = now()
where source_key in (
  'afca',
  'banking_code_compliance_committee',
  'property_council_australia',
  'domain_research',
  'austrac'
);

update public.market_sources
set ingest_mode = 'disabled',
    shadow_promotion_notes = 'Blocked on a commercial agreement, not on engineering. Configure the documented credentials, then move to shadow before going live.',
    updated_at = now()
where source_key in ('australian_financial_review', 'reuters_australia', 'bloomberg_australia');

update public.market_sources
set ingest_mode = 'disabled',
    disabled_reason = 'Re-tested 2026-08-01: /newsroom/media-releases/ is a 14KB client-rendered shell — HTTP 200, zero JSON-LD blocks, zero media-release anchors. Needs a server-rendered listing or a data feed, not a selector change.',
    shadow_promotion_notes = 'Re-test when ASIC publishes a server-rendered listing or a newsroom feed. Nothing to measure in shadow until then.',
    updated_at = now()
where source_key = 'asic_newsroom';

update public.market_sources
set ingest_mode = 'disabled',
    shadow_promotion_notes = 'Excluded on content, not access. Revisit only if the FBAA begins publishing first-party articles.',
    updated_at = now()
where source_key = 'fbaa';

update public.market_sources
set ingest_mode = 'disabled',
    shadow_promotion_notes = 'Re-test if NAB publishes a stable economics feed; the configured RSS endpoint has returned HTTP 404 on every check.',
    updated_at = now()
where source_key = 'nab_economics_market_news';

-- Market Updates article archive and indefinite retention.
alter table public.market_updates
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid,
  add column if not exists pre_archive_status text;

comment on column public.market_updates.archived_at is
  'UTC timestamp at which an operator archived this update; null means active.';
comment on column public.market_updates.archived_by is
  'Authenticated operator UUID that archived the update; null for historical backfill or a removed user.';
comment on column public.market_updates.pre_archive_status is
  'Status captured immediately before archive so restore semantics remain explicit.';

alter table public.market_updates
  drop constraint if exists market_updates_archive_metadata_check;
alter table public.market_updates
  add constraint market_updates_archive_metadata_check check (
    (archived_at is null and archived_by is null and pre_archive_status is null)
    or
    (archived_at is not null and pre_archive_status is not null)
  ) not valid;

update public.market_updates
set archived_at = coalesce(decisioned_at, updated_at, created_at),
    archived_by = null,
    pre_archive_status = 'published',
    status = 'published',
    failure_reason = null,
    updated_at = now()
where status = 'ignored'
  and failure_reason = 'hidden_by_operator'
  and archived_at is null;

alter table public.market_updates
  validate constraint market_updates_archive_metadata_check;

create index if not exists market_updates_archived_at_idx
  on public.market_updates (archived_at desc, id)
  where archived_at is not null;

create index if not exists market_updates_active_feed_idx
  on public.market_updates (visibility, status, source_published_at desc)
  where archived_at is null;

-- Service-only execution evidence is retained independently of article rows so
-- cleanup remains auditable after the payload is permanently removed.
create table if not exists public.market_update_archive_purge_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  completed_at timestamptz not null default now(),
  cutoff_at timestamptz not null,
  deleted_count integer not null default 0 check (deleted_count >= 0),
  status text not null default 'completed' check (status in ('completed'))
);

alter table public.market_update_archive_purge_runs enable row level security;
revoke all on table public.market_update_archive_purge_runs from public, anon, authenticated;
grant all on table public.market_update_archive_purge_runs to service_role;

drop policy if exists "Service role manages market_update_archive_purge_runs"
  on public.market_update_archive_purge_runs;
create policy "Service role manages market_update_archive_purge_runs"
  on public.market_update_archive_purge_runs
  for all to service_role using (true) with check (true);

do $archive_retention$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid)
    from cron.job
    where jobname = 'market-updates-archive-purge-daily';
  end if;
end;
$archive_retention$;

create or replace function public.purge_expired_market_updates_archive()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  raise log 'market_updates archive purge skipped: archived articles have indefinite reversible retention';
  return 0;
end;
$$;

revoke all on function public.purge_expired_market_updates_archive()
  from public, anon, authenticated;
grant execute on function public.purge_expired_market_updates_archive()
  to service_role;

-- Archived published rows must not satisfy active publication-health checks.
create or replace function public.evaluate_market_updates_automation_alerts()
returns void language plpgsql security definer set search_path=public as $$
begin
  insert into public.market_updates_operational_alerts(alert_key,severity,safe_message,metadata)
  select 'cron_stale','error','Market Updates scheduled ingestion has not dispatched within the expected window.',jsonb_build_object('last_dispatch',max(scheduled_at))
  from public.market_updates_automation_runs where job_name='market-updates-ingest-hourly' and dispatch_status='dispatched'
  having max(scheduled_at) is null or max(scheduled_at) < now()-interval '2 hours'
  on conflict (alert_key) where resolved_at is null do update set last_detected_at=now(),metadata=excluded.metadata;

  insert into public.market_updates_operational_alerts(alert_key,severity,safe_message,metadata)
  select 'source_failures','warning','One or more canonical Market Updates sources have repeated failures.',jsonb_build_object('count',count(*))
  from public.market_sources where registry_status='canonical' and enabled and consecutive_failures>=3 having count(*)>0
  on conflict (alert_key) where resolved_at is null do update set last_detected_at=now(),metadata=excluded.metadata;

  insert into public.market_updates_operational_alerts(alert_key,severity,safe_message,metadata)
  select 'digest_failed','error','The latest Market Updates digest generation failed.',jsonb_build_object('period',period,'period_key',period_key)
  from public.market_digests where status='failed' order by completed_at desc nulls last limit 1
  on conflict (alert_key) where resolved_at is null do update set last_detected_at=now(),metadata=excluded.metadata;

  insert into public.market_updates_operational_alerts(alert_key,severity,safe_message,metadata)
  select 'provider_failure','error','The configured Market Updates AI route failed during a recent automated run.',jsonb_build_object('run_id',id)
  from public.market_ingestion_runs where status='failed' and started_at>now()-interval '24 hours' and error_summary ilike '%classifier route%'
  order by started_at desc limit 1
  on conflict (alert_key) where resolved_at is null do update set last_detected_at=now(),metadata=excluded.metadata;

  insert into public.market_updates_operational_alerts(alert_key,severity,safe_message,metadata)
  select 'publication_stale','warning','No Market Updates item has been published during the expected publication window.','{}'::jsonb
  where not exists(select 1 from public.market_updates where status='published' and archived_at is null and ingested_at>now()-interval '72 hours')
  on conflict (alert_key) where resolved_at is null do update set last_detected_at=now();

  update public.market_updates_operational_alerts set resolved_at=now()
  where resolved_at is null and (
    (alert_key='cron_stale' and exists(select 1 from public.market_updates_automation_runs where job_name='market-updates-ingest-hourly' and dispatch_status='dispatched' and scheduled_at>=now()-interval '2 hours')) or
    (alert_key='source_failures' and not exists(select 1 from public.market_sources where registry_status='canonical' and enabled and consecutive_failures>=3)) or
    (alert_key='digest_failed' and exists(select 1 from public.market_digests where status in ('published','no_data') and completed_at>=now()-interval '24 hours')) or
    (alert_key='provider_failure' and not exists(select 1 from public.market_ingestion_runs where status='failed' and started_at>now()-interval '24 hours' and error_summary ilike '%classifier route%')) or
    (alert_key='publication_stale' and exists(select 1 from public.market_updates where status='published' and archived_at is null and ingested_at>now()-interval '72 hours'))
  );
end;
$$;
revoke all on function public.evaluate_market_updates_automation_alerts() from public,anon,authenticated;
grant execute on function public.evaluate_market_updates_automation_alerts() to service_role;

-- The archive purge is the ninth required Market Updates job.
create or replace function public.market_updates_automation_status()
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
  select jsonb_build_object(
    'configured_job_count',(select count(*) from cron.job where jobname like 'market-updates-%'),
    'expected_job_count',9,
    'last_dispatch_at',(select max(scheduled_at) from public.market_updates_automation_runs where dispatch_status='dispatched'),
    'last_ingestion_dispatch_at',(select max(scheduled_at) from public.market_updates_automation_runs where job_name='market-updates-ingest-hourly' and dispatch_status='dispatched'),
    'cron_stale',not exists(select 1 from public.market_updates_automation_runs where job_name='market-updates-ingest-hourly' and dispatch_status='dispatched' and scheduled_at>=now()-interval '2 hours'),
    'required_secrets_present',
      exists(select 1 from vault.decrypted_secrets where name in ('supabase_url','SUPABASE_URL')) and
      exists(select 1 from vault.decrypted_secrets where name in ('market_ingestion_cron_secret','MARKET_INGESTION_CRON_SECRET')),
    'alerts',coalesce((select jsonb_agg(jsonb_build_object('key',alert_key,'severity',severity,'message',safe_message,'last_detected_at',last_detected_at) order by last_detected_at desc) from public.market_updates_operational_alerts where resolved_at is null),'[]'::jsonb)
  ) into result;
  return result;
end;
$$;
revoke all on function public.market_updates_automation_status() from public,anon,authenticated;
grant execute on function public.market_updates_automation_status() to service_role;
