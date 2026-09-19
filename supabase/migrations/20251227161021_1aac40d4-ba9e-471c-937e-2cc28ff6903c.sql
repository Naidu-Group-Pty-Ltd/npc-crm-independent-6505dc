-- Create enum types for depreciation calculator
CREATE TYPE depreciation_purchase_date_category AS ENUM ('pre_budget', 'post_budget_second_hand', 'post_budget_brand_new');
CREATE TYPE depreciation_property_type AS ENUM ('house', 'townhouse', 'unit', 'highrise', 'commercial', 'industrial');
CREATE TYPE depreciation_finish_standard AS ENUM ('low', 'medium', 'high');
CREATE TYPE depreciation_nearest_city AS ENUM ('sydney_nsw', 'melbourne_vic', 'perth_wa', 'brisbane_qld', 'adelaide_sa', 'cairns_qld', 'canberra_act', 'darwin_nt', 'hobart_tas');

-- Create depreciation_comps table for storing comparable property depreciation data
CREATE TABLE public.depreciation_comps (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  -- Match fields
  purchase_price NUMERIC NOT NULL,
  purchase_date_category depreciation_purchase_date_category NOT NULL,
  build_year INTEGER NOT NULL,
  property_type depreciation_property_type NOT NULL,
  finish_standard depreciation_finish_standard NOT NULL,
  nearest_city depreciation_nearest_city NOT NULL,
  renovated BOOLEAN NOT NULL DEFAULT false,
  fully_furnished BOOLEAN NOT NULL DEFAULT false,
  
  -- Diminishing Value results per year
  dv_year1 NUMERIC NOT NULL DEFAULT 0,
  dv_year2 NUMERIC NOT NULL DEFAULT 0,
  dv_year3 NUMERIC NOT NULL DEFAULT 0,
  dv_year4 NUMERIC NOT NULL DEFAULT 0,
  dv_year5 NUMERIC NOT NULL DEFAULT 0,
  dv_year6 NUMERIC NOT NULL DEFAULT 0,
  dv_year7 NUMERIC NOT NULL DEFAULT 0,
  dv_year8 NUMERIC NOT NULL DEFAULT 0,
  dv_year9 NUMERIC NOT NULL DEFAULT 0,
  dv_year10 NUMERIC NOT NULL DEFAULT 0,
  
  -- Prime Cost results per year
  pc_year1 NUMERIC NOT NULL DEFAULT 0,
  pc_year2 NUMERIC NOT NULL DEFAULT 0,
  pc_year3 NUMERIC NOT NULL DEFAULT 0,
  pc_year4 NUMERIC NOT NULL DEFAULT 0,
  pc_year5 NUMERIC NOT NULL DEFAULT 0,
  pc_year6 NUMERIC NOT NULL DEFAULT 0,
  pc_year7 NUMERIC NOT NULL DEFAULT 0,
  pc_year8 NUMERIC NOT NULL DEFAULT 0,
  pc_year9 NUMERIC NOT NULL DEFAULT 0,
  pc_year10 NUMERIC NOT NULL DEFAULT 0,
  
  -- Optional metadata
  notes TEXT,
  source_schedule_id UUID,
  
  -- Created by user
  created_by UUID REFERENCES public.custom_users(id)
);

-- Create depreciation_estimator_runs table for logging calculations
CREATE TABLE public.depreciation_estimator_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  -- Input fields
  purchase_price NUMERIC NOT NULL,
  purchase_date DATE,
  purchase_date_category depreciation_purchase_date_category NOT NULL,
  build_year INTEGER NOT NULL,
  property_type depreciation_property_type NOT NULL,
  finish_standard depreciation_finish_standard NOT NULL,
  nearest_city depreciation_nearest_city NOT NULL,
  renovated BOOLEAN NOT NULL DEFAULT false,
  fully_furnished BOOLEAN NOT NULL DEFAULT false,
  
  -- Matching results
  match_count INTEGER NOT NULL DEFAULT 0,
  top_comp_ids UUID[] DEFAULT '{}',
  confidence_score NUMERIC,
  
  -- Calculated results
  dv_year1 NUMERIC,
  dv_year2 NUMERIC,
  dv_year3 NUMERIC,
  dv_year4 NUMERIC,
  dv_year5 NUMERIC,
  dv_year6 NUMERIC,
  dv_year7 NUMERIC,
  dv_year8 NUMERIC,
  dv_year9 NUMERIC,
  dv_year10 NUMERIC,
  pc_year1 NUMERIC,
  pc_year2 NUMERIC,
  pc_year3 NUMERIC,
  pc_year4 NUMERIC,
  pc_year5 NUMERIC,
  pc_year6 NUMERIC,
  pc_year7 NUMERIC,
  pc_year8 NUMERIC,
  pc_year9 NUMERIC,
  pc_year10 NUMERIC,
  dv_total NUMERIC,
  pc_total NUMERIC,
  
  -- User who ran the calculation
  user_id UUID REFERENCES public.custom_users(id)
);

-- Add indexes for efficient matching
CREATE INDEX idx_depreciation_comps_match ON public.depreciation_comps (
  purchase_date_category,
  property_type,
  finish_standard,
  nearest_city,
  renovated,
  fully_furnished
);

CREATE INDEX idx_depreciation_comps_price_year ON public.depreciation_comps (
  purchase_price,
  build_year
);

-- Enable RLS
ALTER TABLE public.depreciation_comps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.depreciation_estimator_runs ENABLE ROW LEVEL SECURITY;

-- RLS policies for depreciation_comps
CREATE POLICY "Anyone can view depreciation comps"
  ON public.depreciation_comps
  FOR SELECT
  USING (true);

CREATE POLICY "Service role can manage depreciation comps"
  ON public.depreciation_comps
  FOR ALL
  USING (true);

-- RLS policies for depreciation_estimator_runs
CREATE POLICY "Anyone can create estimator runs"
  ON public.depreciation_estimator_runs
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can view estimator runs"
  ON public.depreciation_estimator_runs
  FOR SELECT
  USING (true);

-- Create trigger for updated_at
CREATE TRIGGER update_depreciation_comps_updated_at
  BEFORE UPDATE ON public.depreciation_comps
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();