-- Market Updates: put the held-back canonical sources into shadow mode.
--
-- The canonical registry holds 43 sources; 30 were live and 13 sat at
-- enabled = false, producing no evidence about whether they were worth having.
-- Shadow mode (20260811000000) lets the other 13 be accounted for honestly, and
-- they fall into three groups that need different treatment.
--
-- Group 1 — shadow, because there is a real endpoint to exercise. Their items
-- are classified and held at visibility = 'shadow', so the registry accumulates a
-- would-publish rate per source with no effect on the client feed.
--
-- Group 2 — shadow as a reachability probe. These origins currently refuse this
-- project's egress (HTTP 403) or geoblock it. A plain GET to a public page that
-- answers 403 is a failed request, not a restriction being worked around: nothing
-- here retries with forged credentials, rotates identity or evades a block. The
-- value of keeping them in shadow is that recovery is detected automatically
-- instead of by someone remembering to re-test. They are given a 24-hour cadence
-- so a blocked origin is polled once a day, not hourly.
--
-- Group 3 — stays disabled. There is no endpoint to call at all: three licensed
-- wires with no agreement, plus two sources excluded on evidence rather than on
-- access. Enabling any of them would mean scraping a paywall or shipping a source
-- already shown to carry nothing usable.
--
-- Verification for every claim below was run on 2026-08-01 and is recorded in
-- docs/MARKET_UPDATES_SHADOW_MODE_2026-08-01.md.

-- ---------------------------------------------------------------------------
-- Group 1 — endpoints that answer.
-- ---------------------------------------------------------------------------

-- Federal Register of Legislation. The OData service at api.prod.legislation.gov.au
-- responds unauthenticated, and this change ships the adapter it always needed.
-- Two service quirks shape the configuration: `$orderby` cannot be combined with
-- `$filter`, and a `$filter` on makingDate returns zero rows, so the request asks
-- only for the most recent titles and the subject-matter screen runs in the
-- adapter, and `$top` is capped at 100 by the service. www.legislation.gov.au is
-- added to listing_urls because the public
-- document URL must pass the same host allow-list as every other fetched URL.
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

-- ---------------------------------------------------------------------------
-- Group 2 — reachability probes on a daily cadence.
-- ---------------------------------------------------------------------------

-- The RBA is the single most valuable missing source, and all five of its feeds
-- are reachable from other networks — only this project's egress is refused. It
-- is kept in shadow so the day the CDN stops refusing us, the registry notices.
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

-- ---------------------------------------------------------------------------
-- Group 3 — no endpoint to call; these stay disabled with their reasons intact.
-- ---------------------------------------------------------------------------

-- Three licensed wires. Each needs a signed redistribution agreement and its
-- credentials before there is anything to fetch; scraping the public site is not
-- an acceptable substitute and is not attempted.
update public.market_sources
set ingest_mode = 'disabled',
    shadow_promotion_notes = 'Blocked on a commercial agreement, not on engineering. Configure the documented credentials, then move to shadow before going live.',
    updated_at = now()
where source_key in ('australian_financial_review', 'reuters_australia', 'bloomberg_australia');

-- ASIC re-tested 2026-08-01: /newsroom/ answers 200 but only links section
-- indexes, and /newsroom/media-releases/ is still a 14KB client-rendered shell
-- with no JSON-LD and no article anchors. Shadow mode would record a permanent
-- zero, so it stays disabled until a server-rendered source exists.
update public.market_sources
set ingest_mode = 'disabled',
    disabled_reason = 'Re-tested 2026-08-01: /newsroom/media-releases/ is a 14KB client-rendered shell — HTTP 200, zero JSON-LD blocks, zero media-release anchors. Needs a server-rendered listing or a data feed, not a selector change.',
    shadow_promotion_notes = 'Re-test when ASIC publishes a server-rendered listing or a newsroom feed. Nothing to measure in shadow until then.',
    updated_at = now()
where source_key = 'asic_newsroom';

-- The FBAA exclusion is editorial, not technical: Newshub republishes other
-- outlets that this registry already ingests directly, so shadowing it would only
-- manufacture duplicates of sources already live.
update public.market_sources
set ingest_mode = 'disabled',
    shadow_promotion_notes = 'Excluded on content, not access. Revisit only if the FBAA begins publishing first-party articles.',
    updated_at = now()
where source_key = 'fbaa';

-- NAB has no working feed (news.nab.com.au/feed/ returns HTTP 404, re-tested
-- 2026-08-01) and no listing_urls that the HTML fallback can use safely.
update public.market_sources
set ingest_mode = 'disabled',
    shadow_promotion_notes = 'Re-test if NAB publishes a stable economics feed; the configured RSS endpoint has returned HTTP 404 on every check.',
    updated_at = now()
where source_key = 'nab_economics_market_news';
