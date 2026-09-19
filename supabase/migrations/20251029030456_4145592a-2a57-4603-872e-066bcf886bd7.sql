-- Phase 2: Create schools directory table for storing Australian school data
-- This will enable local lookups instead of relying on unavailable APIs

CREATE TABLE IF NOT EXISTS public.schools_directory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  suburb TEXT NOT NULL,
  postcode TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT')),
  school_type TEXT CHECK (school_type IN ('Government', 'Catholic', 'Independent', 'Other')),
  school_level TEXT CHECK (school_level IN ('Primary', 'Secondary', 'Combined', 'Special', 'Other')),
  icsea_score INTEGER CHECK (icsea_score >= 500 AND icsea_score <= 1500),
  student_count INTEGER CHECK (student_count >= 0),
  latitude DECIMAL(10, 8),
  longitude DECIMAL(11, 8),
  address TEXT,
  website_url TEXT,
  naplan_data JSONB,
  last_updated DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT unique_school_location UNIQUE (name, postcode, state)
);

-- Create indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_schools_postcode ON public.schools_directory(postcode);
CREATE INDEX IF NOT EXISTS idx_schools_state ON public.schools_directory(state);
CREATE INDEX IF NOT EXISTS idx_schools_suburb ON public.schools_directory(suburb);
CREATE INDEX IF NOT EXISTS idx_schools_type ON public.schools_directory(school_type);
CREATE INDEX IF NOT EXISTS idx_schools_level ON public.schools_directory(school_level);

-- Create spatial index for distance-based queries
CREATE INDEX IF NOT EXISTS idx_schools_location ON public.schools_directory USING GIST (
  point(longitude, latitude)
);

-- Create composite index for common query patterns
CREATE INDEX IF NOT EXISTS idx_schools_postcode_state ON public.schools_directory(postcode, state);

-- Enable Row Level Security
ALTER TABLE public.schools_directory ENABLE ROW LEVEL SECURITY;

-- Create policy to allow public read access (schools are public information)
CREATE POLICY "Anyone can view schools directory" 
ON public.schools_directory 
FOR SELECT 
USING (true);

-- Create policy for inserting data (for data imports/admin)
CREATE POLICY "Service role can insert schools data" 
ON public.schools_directory 
FOR INSERT 
WITH CHECK (true);

-- Create policy for updating data (for data refresh/admin)
CREATE POLICY "Service role can update schools data" 
ON public.schools_directory 
FOR UPDATE 
USING (true);

-- Add comment for documentation
COMMENT ON TABLE public.schools_directory IS 'Directory of Australian schools with ICSEA scores, location data, and student counts. Data sourced from state education departments and ACARA.';

-- Create ABS Census data cache table for demographics
CREATE TABLE IF NOT EXISTS public.abs_census_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  postcode TEXT NOT NULL,
  state TEXT NOT NULL,
  dataset TEXT NOT NULL CHECK (dataset IN ('SEIFA', 'population', 'income', 'housing', 'employment', 'education')),
  data JSONB NOT NULL,
  data_quality TEXT NOT NULL DEFAULT 'estimated' CHECK (data_quality IN ('live', 'estimated', 'cached')),
  fetched_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW() + INTERVAL '30 days',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT unique_census_data UNIQUE (postcode, state, dataset)
);

-- Create indexes for ABS cache
CREATE INDEX IF NOT EXISTS idx_census_postcode ON public.abs_census_cache(postcode);
CREATE INDEX IF NOT EXISTS idx_census_dataset ON public.abs_census_cache(dataset);
CREATE INDEX IF NOT EXISTS idx_census_expires ON public.abs_census_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_census_quality ON public.abs_census_cache(data_quality);

-- Enable RLS for census cache
ALTER TABLE public.abs_census_cache ENABLE ROW LEVEL SECURITY;

-- Allow public read access to census data
CREATE POLICY "Anyone can view census cache" 
ON public.abs_census_cache 
FOR SELECT 
USING (true);

-- Service role can manage cache
CREATE POLICY "Service role can manage census cache" 
ON public.abs_census_cache 
FOR ALL 
USING (true);

COMMENT ON TABLE public.abs_census_cache IS 'Cache for ABS census and demographic data to reduce API calls and improve performance. Data expires after 30 days.';

-- Create function to clean up expired census cache entries
CREATE OR REPLACE FUNCTION public.cleanup_expired_census_cache()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.abs_census_cache 
  WHERE expires_at < NOW();
$$;