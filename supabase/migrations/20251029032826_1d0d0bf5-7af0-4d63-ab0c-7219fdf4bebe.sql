-- ============================================
-- Phase 3: Additional Data Sources + Caching
-- ============================================

-- Table 1: Crime Statistics Cache
CREATE TABLE IF NOT EXISTS public.crime_statistics_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  suburb TEXT NOT NULL,
  postcode TEXT NOT NULL,
  state TEXT NOT NULL,
  data JSONB NOT NULL,
  data_quality TEXT NOT NULL DEFAULT 'estimated',
  fetched_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (NOW() + INTERVAL '90 days'),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE(suburb, postcode, state)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_crime_cache_location ON public.crime_statistics_cache(suburb, postcode, state);
CREATE INDEX IF NOT EXISTS idx_crime_cache_expiry ON public.crime_statistics_cache(expires_at);

-- Enable RLS
ALTER TABLE public.crime_statistics_cache ENABLE ROW LEVEL SECURITY;

-- RLS Policies for crime_statistics_cache
CREATE POLICY "Anyone can view crime cache"
  ON public.crime_statistics_cache
  FOR SELECT
  USING (true);

CREATE POLICY "Service role can manage crime cache"
  ON public.crime_statistics_cache
  FOR ALL
  USING (true);

-- Table 2: Public Transport Cache
CREATE TABLE IF NOT EXISTS public.transport_data_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  latitude NUMERIC NOT NULL,
  longitude NUMERIC NOT NULL,
  state TEXT NOT NULL,
  suburb TEXT,
  data JSONB NOT NULL,
  data_quality TEXT NOT NULL DEFAULT 'estimated',
  fetched_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Spatial index for coordinate-based lookups
CREATE INDEX IF NOT EXISTS idx_transport_cache_coords ON public.transport_data_cache(latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_transport_cache_state ON public.transport_data_cache(state);
CREATE INDEX IF NOT EXISTS idx_transport_cache_expiry ON public.transport_data_cache(expires_at);

-- Enable RLS
ALTER TABLE public.transport_data_cache ENABLE ROW LEVEL SECURITY;

-- RLS Policies for transport_data_cache
CREATE POLICY "Anyone can view transport cache"
  ON public.transport_data_cache
  FOR SELECT
  USING (true);

CREATE POLICY "Service role can manage transport cache"
  ON public.transport_data_cache
  FOR ALL
  USING (true);

-- Table 3: Economic Data Cache (RBA)
CREATE TABLE IF NOT EXISTS public.economic_data_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  data_type TEXT NOT NULL,
  data JSONB NOT NULL,
  fetched_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE(data_type)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_economic_cache_type ON public.economic_data_cache(data_type);
CREATE INDEX IF NOT EXISTS idx_economic_cache_expiry ON public.economic_data_cache(expires_at);

-- Enable RLS
ALTER TABLE public.economic_data_cache ENABLE ROW LEVEL SECURITY;

-- RLS Policies for economic_data_cache
CREATE POLICY "Anyone can view economic cache"
  ON public.economic_data_cache
  FOR SELECT
  USING (true);

CREATE POLICY "Service role can manage economic cache"
  ON public.economic_data_cache
  FOR ALL
  USING (true);

-- Function: Cleanup expired crime cache
CREATE OR REPLACE FUNCTION public.cleanup_expired_crime_cache()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  DELETE FROM public.crime_statistics_cache 
  WHERE expires_at < NOW();
$$;

-- Function: Cleanup expired transport cache
CREATE OR REPLACE FUNCTION public.cleanup_expired_transport_cache()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  DELETE FROM public.transport_data_cache 
  WHERE expires_at < NOW();
$$;

-- Function: Cleanup expired economic cache
CREATE OR REPLACE FUNCTION public.cleanup_expired_economic_cache()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  DELETE FROM public.economic_data_cache 
  WHERE expires_at < NOW();
$$;

-- Function: Get cache statistics
CREATE OR REPLACE FUNCTION public.get_cache_statistics()
RETURNS TABLE(
  cache_type TEXT,
  total_entries BIGINT,
  live_data BIGINT,
  estimated_data BIGINT,
  expired_entries BIGINT,
  cache_hit_potential NUMERIC
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT 
    'schools' as cache_type,
    COUNT(*) as total_entries,
    COUNT(*) as live_data,
    0::BIGINT as estimated_data,
    0::BIGINT as expired_entries,
    100.0 as cache_hit_potential
  FROM public.schools_directory
  
  UNION ALL
  
  SELECT 
    'abs_census' as cache_type,
    COUNT(*) as total_entries,
    COUNT(*) FILTER (WHERE data_quality = 'live') as live_data,
    COUNT(*) FILTER (WHERE data_quality = 'estimated') as estimated_data,
    COUNT(*) FILTER (WHERE expires_at < NOW()) as expired_entries,
    ROUND((COUNT(*) FILTER (WHERE expires_at >= NOW())::NUMERIC / NULLIF(COUNT(*), 0) * 100), 2) as cache_hit_potential
  FROM public.abs_census_cache
  
  UNION ALL
  
  SELECT 
    'crime_statistics' as cache_type,
    COUNT(*) as total_entries,
    COUNT(*) FILTER (WHERE data_quality = 'live') as live_data,
    COUNT(*) FILTER (WHERE data_quality = 'estimated') as estimated_data,
    COUNT(*) FILTER (WHERE expires_at < NOW()) as expired_entries,
    ROUND((COUNT(*) FILTER (WHERE expires_at >= NOW())::NUMERIC / NULLIF(COUNT(*), 0) * 100), 2) as cache_hit_potential
  FROM public.crime_statistics_cache
  
  UNION ALL
  
  SELECT 
    'transport_data' as cache_type,
    COUNT(*) as total_entries,
    COUNT(*) FILTER (WHERE data_quality = 'live') as live_data,
    COUNT(*) FILTER (WHERE data_quality = 'estimated') as estimated_data,
    COUNT(*) FILTER (WHERE expires_at < NOW()) as expired_entries,
    ROUND((COUNT(*) FILTER (WHERE expires_at >= NOW())::NUMERIC / NULLIF(COUNT(*), 0) * 100), 2) as cache_hit_potential
  FROM public.transport_data_cache
  
  UNION ALL
  
  SELECT 
    'economic_data' as cache_type,
    COUNT(*) as total_entries,
    COUNT(*) as live_data,
    0::BIGINT as estimated_data,
    COUNT(*) FILTER (WHERE expires_at < NOW()) as expired_entries,
    ROUND((COUNT(*) FILTER (WHERE expires_at >= NOW())::NUMERIC / NULLIF(COUNT(*), 0) * 100), 2) as cache_hit_potential
  FROM public.economic_data_cache;
$$;