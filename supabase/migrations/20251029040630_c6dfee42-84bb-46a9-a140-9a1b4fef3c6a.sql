-- Add 'demographics' to the allowed dataset values for abs_census_cache
ALTER TABLE public.abs_census_cache 
DROP CONSTRAINT IF EXISTS abs_census_cache_dataset_check;

ALTER TABLE public.abs_census_cache 
ADD CONSTRAINT abs_census_cache_dataset_check 
CHECK (dataset = ANY (ARRAY['SEIFA'::text, 'population'::text, 'income'::text, 'housing'::text, 'employment'::text, 'education'::text, 'demographics'::text]));