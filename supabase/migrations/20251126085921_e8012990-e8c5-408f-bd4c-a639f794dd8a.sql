-- Fix search_path security warnings for newly created functions

-- Recreate validate_property_specs with security definer and set search_path
DROP FUNCTION IF EXISTS validate_property_specs(JSONB);

CREATE OR REPLACE FUNCTION validate_property_specs(specs JSONB)
RETURNS TABLE(is_valid BOOLEAN, missing_fields TEXT[]) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

-- Recreate calculate_data_quality_score with security definer and set search_path
DROP FUNCTION IF EXISTS calculate_data_quality_score(UUID);

CREATE OR REPLACE FUNCTION calculate_data_quality_score(report_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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