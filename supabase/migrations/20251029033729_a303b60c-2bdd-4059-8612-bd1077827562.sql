-- ============================================
-- Week 5-6: Risk Assessment & Climate Data Caching
-- ============================================

-- Table 1: Risk Assessment Cache
CREATE TABLE IF NOT EXISTS public.risk_assessment_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  suburb TEXT NOT NULL,
  postcode TEXT NOT NULL,
  state TEXT NOT NULL,
  latitude NUMERIC,
  longitude NUMERIC,
  flood_risk JSONB,
  bushfire_risk JSONB,
  data_quality TEXT NOT NULL DEFAULT 'estimated',
  fetched_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (NOW() + INTERVAL '180 days'),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE(suburb, postcode, state)
);

-- Indexes for risk assessment cache
CREATE INDEX IF NOT EXISTS idx_risk_cache_location ON public.risk_assessment_cache(suburb, postcode, state);
CREATE INDEX IF NOT EXISTS idx_risk_cache_coords ON public.risk_assessment_cache(latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_risk_cache_expiry ON public.risk_assessment_cache(expires_at);

-- Enable RLS
ALTER TABLE public.risk_assessment_cache ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Anyone can view risk cache"
  ON public.risk_assessment_cache
  FOR SELECT
  USING (true);

CREATE POLICY "Service role can manage risk cache"
  ON public.risk_assessment_cache
  FOR ALL
  USING (true);

-- Table 2: Climate Data Cache
CREATE TABLE IF NOT EXISTS public.climate_data_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  suburb TEXT,
  postcode TEXT,
  state TEXT NOT NULL,
  climate_zone TEXT,
  temperature_data JSONB,
  rainfall_data JSONB,
  humidity_data JSONB,
  extreme_weather JSONB,
  projections JSONB,
  data_quality TEXT NOT NULL DEFAULT 'estimated',
  fetched_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (NOW() + INTERVAL '365 days'),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE(state, postcode)
);

-- Indexes for climate data cache
CREATE INDEX IF NOT EXISTS idx_climate_cache_state ON public.climate_data_cache(state);
CREATE INDEX IF NOT EXISTS idx_climate_cache_postcode ON public.climate_data_cache(postcode);
CREATE INDEX IF NOT EXISTS idx_climate_cache_expiry ON public.climate_data_cache(expires_at);

-- Enable RLS
ALTER TABLE public.climate_data_cache ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Anyone can view climate cache"
  ON public.climate_data_cache
  FOR SELECT
  USING (true);

CREATE POLICY "Service role can manage climate cache"
  ON public.climate_data_cache
  FOR ALL
  USING (true);

-- Table 3: API Monitoring & Health
CREATE TABLE IF NOT EXISTS public.api_health_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_name TEXT NOT NULL,
  endpoint TEXT,
  status TEXT NOT NULL,
  response_time_ms INTEGER,
  error_message TEXT,
  data_quality TEXT,
  user_id UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Indexes for API health log
CREATE INDEX IF NOT EXISTS idx_health_log_service ON public.api_health_log(service_name);
CREATE INDEX IF NOT EXISTS idx_health_log_status ON public.api_health_log(status);
CREATE INDEX IF NOT EXISTS idx_health_log_created ON public.api_health_log(created_at DESC);

-- Enable RLS
ALTER TABLE public.api_health_log ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Anyone can view API health logs"
  ON public.api_health_log
  FOR SELECT
  USING (true);

CREATE POLICY "Service role can manage API health logs"
  ON public.api_health_log
  FOR ALL
  USING (true);

-- Cleanup functions
CREATE OR REPLACE FUNCTION public.cleanup_expired_risk_cache()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  DELETE FROM public.risk_assessment_cache 
  WHERE expires_at < NOW();
$$;

CREATE OR REPLACE FUNCTION public.cleanup_expired_climate_cache()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  DELETE FROM public.climate_data_cache 
  WHERE expires_at < NOW();
$$;

CREATE OR REPLACE FUNCTION public.cleanup_old_health_logs()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  DELETE FROM public.api_health_log 
  WHERE created_at < NOW() - INTERVAL '30 days';
$$;

-- Function: Get API health statistics
CREATE OR REPLACE FUNCTION public.get_api_health_stats(days_back INTEGER DEFAULT 7)
RETURNS TABLE(
  service_name TEXT,
  total_calls BIGINT,
  success_calls BIGINT,
  error_calls BIGINT,
  success_rate NUMERIC,
  avg_response_time NUMERIC,
  live_data_count BIGINT,
  estimated_data_count BIGINT,
  data_quality_score NUMERIC
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT 
    service_name,
    COUNT(*) as total_calls,
    COUNT(*) FILTER (WHERE status = 'success') as success_calls,
    COUNT(*) FILTER (WHERE status = 'error') as error_calls,
    ROUND((COUNT(*) FILTER (WHERE status = 'success')::NUMERIC / NULLIF(COUNT(*), 0) * 100), 2) as success_rate,
    ROUND(AVG(response_time_ms)) as avg_response_time,
    COUNT(*) FILTER (WHERE data_quality = 'live') as live_data_count,
    COUNT(*) FILTER (WHERE data_quality = 'estimated') as estimated_data_count,
    ROUND((COUNT(*) FILTER (WHERE data_quality = 'live')::NUMERIC / NULLIF(COUNT(*), 0) * 100), 2) as data_quality_score
  FROM public.api_health_log
  WHERE created_at >= NOW() - (days_back || ' days')::INTERVAL
  GROUP BY service_name
  ORDER BY total_calls DESC;
$$;

-- Function: Get comprehensive cache statistics (updated to include new tables)
CREATE OR REPLACE FUNCTION public.get_all_cache_stats()
RETURNS TABLE(
  cache_type TEXT,
  total_entries BIGINT,
  live_data BIGINT,
  estimated_data BIGINT,
  expired_entries BIGINT,
  cache_hit_potential NUMERIC,
  avg_age_days NUMERIC,
  retention_days INTEGER
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT 'schools_directory' as cache_type, COUNT(*), COUNT(*), 0::BIGINT, 0::BIGINT, 100.0, 0::NUMERIC, -1
  FROM public.schools_directory
  
  UNION ALL
  
  SELECT 'abs_census' as cache_type,
    COUNT(*), 
    COUNT(*) FILTER (WHERE data_quality = 'live'),
    COUNT(*) FILTER (WHERE data_quality = 'estimated'),
    COUNT(*) FILTER (WHERE expires_at < NOW()),
    ROUND((COUNT(*) FILTER (WHERE expires_at >= NOW())::NUMERIC / NULLIF(COUNT(*), 0) * 100), 2),
    ROUND(AVG(EXTRACT(EPOCH FROM (NOW() - fetched_at)) / 86400), 1),
    30
  FROM public.abs_census_cache
  
  UNION ALL
  
  SELECT 'crime_statistics' as cache_type,
    COUNT(*),
    COUNT(*) FILTER (WHERE data_quality = 'live'),
    COUNT(*) FILTER (WHERE data_quality = 'estimated'),
    COUNT(*) FILTER (WHERE expires_at < NOW()),
    ROUND((COUNT(*) FILTER (WHERE expires_at >= NOW())::NUMERIC / NULLIF(COUNT(*), 0) * 100), 2),
    ROUND(AVG(EXTRACT(EPOCH FROM (NOW() - fetched_at)) / 86400), 1),
    90
  FROM public.crime_statistics_cache
  
  UNION ALL
  
  SELECT 'transport_data' as cache_type,
    COUNT(*),
    COUNT(*) FILTER (WHERE data_quality = 'live'),
    COUNT(*) FILTER (WHERE data_quality = 'estimated'),
    COUNT(*) FILTER (WHERE expires_at < NOW()),
    ROUND((COUNT(*) FILTER (WHERE expires_at >= NOW())::NUMERIC / NULLIF(COUNT(*), 0) * 100), 2),
    ROUND(AVG(EXTRACT(EPOCH FROM (NOW() - fetched_at)) / 86400), 1),
    30
  FROM public.transport_data_cache
  
  UNION ALL
  
  SELECT 'economic_data' as cache_type,
    COUNT(*),
    COUNT(*),
    0::BIGINT,
    COUNT(*) FILTER (WHERE expires_at < NOW()),
    ROUND((COUNT(*) FILTER (WHERE expires_at >= NOW())::NUMERIC / NULLIF(COUNT(*), 0) * 100), 2),
    ROUND(AVG(EXTRACT(EPOCH FROM (NOW() - fetched_at)) / 86400), 1),
    7
  FROM public.economic_data_cache
  
  UNION ALL
  
  SELECT 'risk_assessment' as cache_type,
    COUNT(*),
    COUNT(*) FILTER (WHERE data_quality = 'live'),
    COUNT(*) FILTER (WHERE data_quality = 'estimated'),
    COUNT(*) FILTER (WHERE expires_at < NOW()),
    ROUND((COUNT(*) FILTER (WHERE expires_at >= NOW())::NUMERIC / NULLIF(COUNT(*), 0) * 100), 2),
    ROUND(AVG(EXTRACT(EPOCH FROM (NOW() - fetched_at)) / 86400), 1),
    180
  FROM public.risk_assessment_cache
  
  UNION ALL
  
  SELECT 'climate_data' as cache_type,
    COUNT(*),
    COUNT(*) FILTER (WHERE data_quality = 'live'),
    COUNT(*) FILTER (WHERE data_quality = 'estimated'),
    COUNT(*) FILTER (WHERE expires_at < NOW()),
    ROUND((COUNT(*) FILTER (WHERE expires_at >= NOW())::NUMERIC / NULLIF(COUNT(*), 0) * 100), 2),
    ROUND(AVG(EXTRACT(EPOCH FROM (NOW() - fetched_at)) / 86400), 1),
    365
  FROM public.climate_data_cache;
$$;