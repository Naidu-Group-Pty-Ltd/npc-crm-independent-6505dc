-- Phase 1: Add property specifications and validation metadata to investment_reports

-- Add property_specs JSONB column to store structured property data
ALTER TABLE investment_reports 
ADD COLUMN IF NOT EXISTS property_specs JSONB DEFAULT '{}'::jsonb;

-- Add calculation metadata for versioning and validation
ALTER TABLE investment_reports
ADD COLUMN IF NOT EXISTS calculation_version VARCHAR(10) DEFAULT '1.0.0',
ADD COLUMN IF NOT EXISTS validation_flags JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS data_sources JSONB DEFAULT '{}'::jsonb;

-- Create index for efficient querying of property specs
CREATE INDEX IF NOT EXISTS idx_investment_reports_property_specs ON investment_reports USING GIN (property_specs);
CREATE INDEX IF NOT EXISTS idx_investment_reports_validation_flags ON investment_reports USING GIN (validation_flags);

-- Add comment explaining property_specs structure
COMMENT ON COLUMN investment_reports.property_specs IS 'Structured property data: {land_size_sqm, building_size_sqm, bedrooms, bathrooms, parking, year_built, property_type, zoning, council_area}';

COMMENT ON COLUMN investment_reports.validation_flags IS 'Array of validation warnings/errors: [{type, severity, field, message, value, expected_range}]';

COMMENT ON COLUMN investment_reports.data_sources IS 'Tracks data origin and confidence: {field_name: {source, confidence, timestamp, value}}';

-- Create a function to validate property specs completeness
CREATE OR REPLACE FUNCTION validate_property_specs(specs JSONB)
RETURNS TABLE(is_valid BOOLEAN, missing_fields TEXT[]) 
LANGUAGE plpgsql
AS $$
DECLARE
  required_fields TEXT[] := ARRAY['land_size_sqm', 'building_size_sqm', 'bedrooms', 'bathrooms', 'property_type'];
  missing TEXT[] := ARRAY[]::TEXT[];
  field TEXT;
BEGIN
  FOREACH field IN ARRAY required_fields
  LOOP
    IF NOT (specs ? field) OR (specs->field IS NULL) OR (specs->>field = '') THEN
      missing := array_append(missing, field);
    END IF;
  END LOOP;
  
  RETURN QUERY SELECT (array_length(missing, 1) IS NULL OR array_length(missing, 1) = 0), missing;
END;
$$;

-- Create a function to calculate data quality score
CREATE OR REPLACE FUNCTION calculate_data_quality_score(report_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  quality_score INTEGER := 100;
  report_record RECORD;
  spec_validation RECORD;
BEGIN
  SELECT * INTO report_record FROM investment_reports WHERE id = report_id;
  
  IF NOT FOUND THEN
    RETURN 0;
  END IF;
  
  -- Deduct points for missing property specs
  SELECT * INTO spec_validation FROM validate_property_specs(report_record.property_specs);
  IF NOT spec_validation.is_valid THEN
    quality_score := quality_score - (array_length(spec_validation.missing_fields, 1) * 10);
  END IF;
  
  -- Deduct points for validation flags
  IF report_record.validation_flags IS NOT NULL THEN
    quality_score := quality_score - (jsonb_array_length(report_record.validation_flags) * 5);
  END IF;
  
  -- Deduct points if using estimated data
  IF report_record.demographics_data IS NOT NULL THEN
    IF (report_record.demographics_data->>'data_quality' = 'estimated') THEN
      quality_score := quality_score - 10;
    END IF;
  END IF;
  
  RETURN GREATEST(0, quality_score);
END;
$$;