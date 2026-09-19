-- Fix the archive_report_version trigger to properly increment current_version
CREATE OR REPLACE FUNCTION public.archive_report_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  next_version INTEGER;
  quality INTEGER;
BEGIN
  -- Get the next version number for this report
  SELECT COALESCE(MAX(version_number), 0) + 1 
  INTO next_version
  FROM public.report_versions
  WHERE report_id = NEW.id;
  
  -- Calculate quality score if validation_flags exist
  quality := 100;
  IF NEW.validation_flags IS NOT NULL AND jsonb_array_length(NEW.validation_flags) > 0 THEN
    -- Simple scoring: deduct 5 points per validation flag
    quality := GREATEST(0, 100 - (jsonb_array_length(NEW.validation_flags) * 5));
  END IF;
  
  -- Only archive if there's existing content (not on first insert)
  IF OLD.report_content IS NOT NULL AND OLD.report_content != '' THEN
    INSERT INTO public.report_versions (
      report_id,
      version_number,
      report_content,
      sources_content,
      property_specs,
      validation_flags,
      data_sources,
      financial_calculations,
      investment_score,
      location_intelligence,
      demographics_data,
      economic_data,
      calculation_version,
      created_by,
      quality_score,
      changelog
    ) VALUES (
      NEW.id,
      next_version,
      OLD.report_content,
      OLD.sources_content,
      OLD.property_specs,
      OLD.validation_flags,
      OLD.data_sources,
      OLD.financial_calculations,
      OLD.investment_score,
      OLD.location_intelligence,
      OLD.demographics_data,
      OLD.economic_data,
      OLD.calculation_version,
      NEW.generated_by,
      quality,
      'Report regenerated - archived previous version'
    );
    
    -- Increment the current_version counter
    NEW.current_version := next_version + 1;
  END IF;
  
  RETURN NEW;
END;
$function$;