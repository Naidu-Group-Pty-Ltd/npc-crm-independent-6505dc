-- Add property metadata fields to property_comparisons table
ALTER TABLE public.property_comparisons 
ADD COLUMN IF NOT EXISTS property_addresses text[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS property_states text[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS report_title text,
ADD COLUMN IF NOT EXISTS structure_version integer DEFAULT 1;

-- Add index for faster lookups by state
CREATE INDEX IF NOT EXISTS idx_property_comparisons_states ON public.property_comparisons USING GIN(property_states);

-- Add comment explaining the new fields
COMMENT ON COLUMN public.property_comparisons.property_addresses IS 'Array of property addresses being compared';
COMMENT ON COLUMN public.property_comparisons.property_states IS 'Array of unique states where properties are located';
COMMENT ON COLUMN public.property_comparisons.report_title IS 'Auto-generated title based on property count and states';
COMMENT ON COLUMN public.property_comparisons.structure_version IS 'Version number for report structure template';