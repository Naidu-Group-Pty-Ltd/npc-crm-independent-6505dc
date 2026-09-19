-- Create suburb directory table for valid Australian suburbs
CREATE TABLE public.suburb_directory (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  suburb TEXT NOT NULL,
  state TEXT NOT NULL,
  postcode TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(suburb, state, postcode)
);

-- Create median rent cache table
CREATE TABLE public.median_rent_cache (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  suburb TEXT NOT NULL,
  state TEXT NOT NULL,
  postcode TEXT NOT NULL,
  property_type TEXT NOT NULL, -- 'house', 'unit', 'townhouse'
  bedrooms INTEGER NOT NULL, -- 1, 2, 3, 4 (4 = 4+)
  median_weekly_rent NUMERIC,
  vacancy_rate NUMERIC,
  stock_on_market INTEGER,
  data_quality TEXT NOT NULL DEFAULT 'live',
  source_url TEXT,
  fetched_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (now() + INTERVAL '30 days'),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(suburb, state, postcode, property_type, bedrooms)
);

-- Enable RLS on both tables
ALTER TABLE public.suburb_directory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.median_rent_cache ENABLE ROW LEVEL SECURITY;

-- RLS policies for suburb_directory
CREATE POLICY "Anyone can view suburb directory"
  ON public.suburb_directory
  FOR SELECT
  USING (true);

CREATE POLICY "Service role can manage suburb directory"
  ON public.suburb_directory
  FOR ALL
  USING (true);

-- RLS policies for median_rent_cache
CREATE POLICY "Anyone can view rent cache"
  ON public.median_rent_cache
  FOR SELECT
  USING (true);

CREATE POLICY "Service role can manage rent cache"
  ON public.median_rent_cache
  FOR ALL
  USING (true);

-- Create indexes for efficient lookups
CREATE INDEX idx_suburb_directory_lookup ON public.suburb_directory(UPPER(suburb), state);
CREATE INDEX idx_suburb_directory_postcode ON public.suburb_directory(postcode);
CREATE INDEX idx_rent_cache_lookup ON public.median_rent_cache(UPPER(suburb), state, property_type, bedrooms);
CREATE INDEX idx_rent_cache_postcode ON public.median_rent_cache(postcode, property_type, bedrooms);
CREATE INDEX idx_rent_cache_expires ON public.median_rent_cache(expires_at);

-- Cleanup function for expired rent cache
CREATE OR REPLACE FUNCTION public.cleanup_expired_rent_cache()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.median_rent_cache 
  WHERE expires_at < NOW();
$$;