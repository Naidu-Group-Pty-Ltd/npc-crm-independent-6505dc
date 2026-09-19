-- Fix versioning: archive exactly once per regeneration (at the moment status flips to 'processing')

CREATE OR REPLACE FUNCTION public.archive_report_version()
RETURNS TRIGGER AS $$
DECLARE
  next_version INTEGER;
  quality INTEGER;
  is_explicit_rollback BOOLEAN;
  content_actually_changed BOOLEAN;
  is_starting_regeneration BOOLEAN;
BEGIN
  -- Only act when report_content meaningfully changes
  content_actually_changed := (
    OLD.report_content IS DISTINCT FROM NEW.report_content
    AND NEW.report_content IS NOT NULL
    AND NEW.report_content <> ''
    AND LENGTH(NEW.report_content) > 1000
  );

  IF NOT content_actually_changed THEN
    RETURN NEW;
  END IF;

  -- Explicit rollback: do not archive or bump versions
  is_explicit_rollback := (
    NEW.current_version IS NOT NULL
    AND OLD.current_version IS NOT NULL
    AND NEW.current_version < OLD.current_version
  );

  IF is_explicit_rollback THEN
    RETURN NEW;
  END IF;

  -- Archive ONLY once per regeneration: when status transitions into 'processing'
  is_starting_regeneration := (
    NEW.status = 'processing'
    AND (OLD.status IS DISTINCT FROM 'processing')
  );

  IF NOT is_starting_regeneration THEN
    RETURN NEW;
  END IF;

  -- Only archive if there is existing content to archive
  IF OLD.report_content IS NULL OR OLD.report_content = '' THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(MAX(version_number), 0) + 1
    INTO next_version
  FROM public.report_versions
  WHERE report_id = NEW.id;

  quality := 100;
  IF OLD.validation_flags IS NOT NULL AND jsonb_array_length(OLD.validation_flags) > 0 THEN
    quality := GREATEST(0, 100 - (jsonb_array_length(OLD.validation_flags) * 5));
  END IF;

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
    'Report regenerated - archived previous version (start regeneration)'
  );

  -- Bump current_version exactly once per regeneration
  NEW.current_version := next_version + 1;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Recreate trigger to ensure the latest function definition is used
DROP TRIGGER IF EXISTS archive_before_regeneration ON public.investment_reports;

CREATE TRIGGER archive_before_regeneration
  BEFORE UPDATE OF report_content ON public.investment_reports
  FOR EACH ROW
  WHEN (OLD.report_content IS DISTINCT FROM NEW.report_content)
  EXECUTE FUNCTION public.archive_report_version();
