
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- === Base tables ===
CREATE TABLE IF NOT EXISTS public.market_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text NULL,
  source_type text NOT NULL,
  url text NOT NULL,
  category text NOT NULL,
  geography text NOT NULL DEFAULT 'Australia',
  reliability_tier text NOT NULL DEFAULT 'watchlist',
  enabled boolean NOT NULL DEFAULT false,
  refresh_frequency_hours integer NOT NULL DEFAULT 24,
  last_fetched_at timestamptz NULL,
  last_success_at timestamptz NULL,
  last_error text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.market_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NULL REFERENCES public.market_sources(id) ON DELETE SET NULL,
  source_name text NOT NULL,
  source_url text NOT NULL,
  source_published_at timestamptz NULL,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  title text NOT NULL,
  slug text NULL,
  category text NOT NULL,
  geography jsonb NOT NULL DEFAULT '[]'::jsonb,
  impact_level text NOT NULL DEFAULT 'medium',
  audience_tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  raw_excerpt text NULL,
  raw_content_hash text NULL,
  ai_summary text NULL,
  key_points jsonb NOT NULL DEFAULT '[]'::jsonb,
  why_it_matters text NULL,
  property_implications text NULL,
  finance_implications text NULL,
  policy_implications text NULL,
  risk_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  confidence_score numeric NULL,
  citation_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  relevance_score numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'candidate',
  failure_reason text NULL,
  dedupe_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.market_digests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  generated_at timestamptz NOT NULL DEFAULT now(),
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  executive_summary text NOT NULL,
  top_update_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  finance_lending_highlights jsonb NOT NULL DEFAULT '[]'::jsonb,
  property_market_highlights jsonb NOT NULL DEFAULT '[]'::jsonb,
  construction_supply_highlights jsonb NOT NULL DEFAULT '[]'::jsonb,
  policy_regulation_highlights jsonb NOT NULL DEFAULT '[]'::jsonb,
  political_economic_watchpoints jsonb NOT NULL DEFAULT '[]'::jsonb,
  buyer_implications text NULL,
  investor_implications text NULL,
  broker_adviser_implications text NULL,
  client_advisory_implications jsonb NOT NULL DEFAULT '[]'::jsonb,
  recommended_watchlist_for_tomorrow jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  confidence_score numeric NULL,
  status text NOT NULL DEFAULT 'published',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.market_update_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question text NOT NULL,
  answer text NOT NULL,
  source_update_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  citation_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  confidence_score numeric NULL,
  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- === Phase 1 upgrades ===
ALTER TABLE public.market_updates
  ADD COLUMN IF NOT EXISTS segments jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS freshness_tier text NULL;

ALTER TABLE public.market_digests
  ADD COLUMN IF NOT EXISTS period text NOT NULL DEFAULT '24h',
  ADD COLUMN IF NOT EXISTS segment_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS social_watchpoints jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'market_digests_period_check') THEN
    ALTER TABLE public.market_digests
      ADD CONSTRAINT market_digests_period_check
      CHECK (period IN ('24h','weekly','biweekly','monthly','quarterly','annual'));
  END IF;
END $$;

-- === Indexes ===
CREATE INDEX IF NOT EXISTS idx_market_sources_enabled ON public.market_sources(enabled);
CREATE INDEX IF NOT EXISTS idx_market_sources_category ON public.market_sources(category);
CREATE INDEX IF NOT EXISTS idx_market_updates_status ON public.market_updates(status);
CREATE INDEX IF NOT EXISTS idx_market_updates_category ON public.market_updates(category);
CREATE INDEX IF NOT EXISTS idx_market_updates_impact ON public.market_updates(impact_level);
CREATE INDEX IF NOT EXISTS idx_market_updates_source_published_at ON public.market_updates(source_published_at);
CREATE INDEX IF NOT EXISTS idx_market_updates_ingested_at ON public.market_updates(ingested_at);
CREATE INDEX IF NOT EXISTS idx_market_updates_freshness ON public.market_updates(freshness_tier);
CREATE INDEX IF NOT EXISTS idx_market_digests_generated_at ON public.market_digests(generated_at);
CREATE INDEX IF NOT EXISTS idx_market_digests_period ON public.market_digests(period);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_market_digests_period_start ON public.market_digests(period, period_start);

-- === Grants ===
GRANT SELECT ON public.market_sources TO authenticated;
GRANT ALL ON public.market_sources TO service_role;
GRANT SELECT ON public.market_updates TO authenticated;
GRANT ALL ON public.market_updates TO service_role;
GRANT SELECT ON public.market_digests TO authenticated;
GRANT ALL ON public.market_digests TO service_role;
GRANT SELECT, INSERT ON public.market_update_questions TO authenticated;
GRANT ALL ON public.market_update_questions TO service_role;

-- === RLS ===
ALTER TABLE public.market_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_digests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_update_questions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read market sources" ON public.market_sources;
CREATE POLICY "Authenticated users can read market sources" ON public.market_sources FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated users can read published market updates" ON public.market_updates;
CREATE POLICY "Authenticated users can read published market updates" ON public.market_updates FOR SELECT TO authenticated USING (status = 'published');

DROP POLICY IF EXISTS "Authenticated users can read published market digests" ON public.market_digests;
CREATE POLICY "Authenticated users can read published market digests" ON public.market_digests FOR SELECT TO authenticated USING (status = 'published');

DROP POLICY IF EXISTS "Authenticated users can insert own market questions" ON public.market_update_questions;
CREATE POLICY "Authenticated users can insert own market questions" ON public.market_update_questions FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can read market questions" ON public.market_update_questions;
CREATE POLICY "Authenticated users can read market questions" ON public.market_update_questions FOR SELECT TO authenticated USING (true);

-- === Source seeds (all disabled by default) ===
INSERT INTO public.market_sources
  (name, description, source_type, url, category, geography, reliability_tier, enabled, refresh_frequency_hours)
VALUES
  ('Reserve Bank of Australia','Official monetary policy and financial stability updates.','rss','https://www.rba.gov.au/rss/rss-cb.xml','finance','Australia','official',false,24),
  ('Australian Bureau of Statistics','Official economic, lending, population and building approvals releases.','rss','https://www.abs.gov.au/rss.xml','economy','Australia','official',false,24),
  ('APRA Media Releases','Prudential regulator lending, capital and macroprudential updates.','rss','https://www.apra.gov.au/rss/media-releases','finance','Australia','official',false,12),
  ('ABS Lending Indicators','ABS lending flows for housing and business.','rss','https://www.abs.gov.au/statistics/economy/finance/lending-indicators/latest-release/rss.xml','finance','Australia','official',false,24),
  ('CoreLogic / Cotality News','Property market analytics and index commentary.','rss','https://www.corelogic.com.au/news-research/news/feed','property_market','Australia','industry',false,12),
  ('PropTrack Insights','REA Group PropTrack property market insights.','rss','https://www.proptrack.com.au/feed/','property_market','Australia','industry',false,12),
  ('Domain Research','Domain research and market reports.','rss','https://www.domain.com.au/research/feed/','property_market','Australia','industry',false,24),
  ('SQM Research','Vacancy, asking prices and rental research.','rss','https://sqmresearch.com.au/feed','property_market','Australia','industry',false,24),
  ('HIA Media','Housing Industry Association media releases.','rss','https://hia.com.au/rss/media-releases','construction','Australia','industry',false,24),
  ('Master Builders Australia','Master Builders policy and market releases.','rss','https://www.masterbuilders.com.au/rss/news','construction','Australia','industry',false,24),
  ('ABS Building Approvals','Monthly building approvals data.','rss','https://www.abs.gov.au/statistics/industry/building-and-construction/building-approvals-australia/latest-release/rss.xml','construction','Australia','official',false,24),
  ('Infrastructure Australia','National infrastructure pipeline and policy.','rss','https://www.infrastructureaustralia.gov.au/rss.xml','planning_supply','Australia','official',false,48),
  ('Parliament of Australia — Housing','Federal parliament housing committee and bills.','rss','https://www.aph.gov.au/News_and_Events/rss','political','Australia','official',false,24),
  ('Treasury Ministers','Treasurer and Assistant Treasurer media.','rss','https://ministers.treasury.gov.au/rss.xml','political','Australia','official',false,12),
  ('ABS Consumer Price Index','Quarterly CPI release feed.','rss','https://www.abs.gov.au/statistics/economy/price-indexes-and-inflation/consumer-price-index-australia/latest-release/rss.xml','economy','Australia','official',false,24),
  ('ABS Labour Force','Monthly unemployment and participation data.','rss','https://www.abs.gov.au/statistics/labour/employment-and-unemployment/labour-force-australia/latest-release/rss.xml','economy','Australia','official',false,24),
  ('Treasury Publications','Treasury economic notes and statements.','rss','https://treasury.gov.au/rss/publications.xml','economy','Australia','official',false,24),
  ('AHURI News','Australian Housing and Urban Research Institute.','rss','https://www.ahuri.edu.au/rss/news','other','Australia','industry',false,48),
  ('ACOSS Housing','ACOSS housing affordability and social policy.','rss','https://www.acoss.org.au/feed/','other','Australia','industry',false,48),
  ('Productivity Commission','PC housing, planning and productivity releases.','rss','https://www.pc.gov.au/rss/news.xml','other','Australia','official',false,48),
  ('ASIC Media Releases','ASIC credit, licensing and enforcement.','rss','https://asic.gov.au/rss/media-releases.xml','policy_regulation','Australia','official',false,24),
  ('NSW Revenue Office','NSW land tax, stamp duty and first-home schemes.','rss','https://www.revenue.nsw.gov.au/rss/news','policy_regulation','NSW','official',false,48),
  ('State Revenue Office VIC','VIC land tax, duties and grants.','rss','https://www.sro.vic.gov.au/rss/news','policy_regulation','VIC','official',false,48),
  ('PropTrack Rental Report','PropTrack rental market reports.','rss','https://www.proptrack.com.au/category/rentals/feed/','rental_market','Australia','industry',false,24),
  ('SQM Vacancy Rates','Monthly residential vacancy rate release.','rss','https://sqmresearch.com.au/vacancy-rates-feed','rental_market','Australia','industry',false,24)
ON CONFLICT DO NOTHING;
