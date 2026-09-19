-- Archive report versions ONLY when a regeneration completes (prevents multiple version bumps during progressive saves)

CREATE OR REPLACE FUNCTION public.archive_report_version()
RETURNS TRIGGER AS $$
DECLARE
  next_version INTEGER;
  quality INTEGER;
  is_explicit_rollback BOOLEAN;
  content_actually_changed BOOLEAN;
  is_finalizing_completion BOOLEAN;
BEGIN
  -- Check if report_content actually changed (not just status or other fields)
  content_actually_changed := (
    OLD.report_content IS DISTINCT FROM NEW.report_content 
    AND NEW.report_content IS NOT NULL 
    AND NEW.report_content != ''
    AND LENGTH(NEW.report_content) > 1000  -- Ensure it's substantial content
  );

  -- If content didn't change, just return the new row without archiving
  IF NOT content_actually_changed THEN
    RETURN NEW;
  END IF;

  -- Check if this is an explicit rollback (current_version is being set to a lower number)
  is_explicit_rollback := (
    NEW.current_version IS NOT NULL 
    AND OLD.current_version IS NOT NULL 
    AND NEW.current_version < OLD.current_version
  );

  -- For explicit rollbacks, don't create a new version - just allow the update
  IF is_explicit_rollback THEN
    RETURN NEW;
  END IF;

  -- Only archive when we are FINALIZING a report: status transitions to 'completed'
  -- This prevents progressive saves (status = 'processing') from generating multiple versions.
  is_finalizing_completion := (
    NEW.status = 'completed'
    AND (OLD.status IS DISTINCT FROM 'completed')
  );

  IF NOT is_finalizing_completion THEN
    RETURN NEW;
  END IF;

  -- Get the next version number for this report
  SELECT COALESCE(MAX(version_number), 0) + 1 
  INTO next_version
  FROM public.report_versions
  WHERE report_id = NEW.id;

  -- Calculate quality score if validation_flags exist
  quality := 100;
  IF NEW.validation_flags IS NOT NULL AND jsonb_array_length(NEW.validation_flags) > 0 THEN
    quality := GREATEST(0, 100 - (jsonb_array_length(NEW.validation_flags) * 5));
  END IF;

  -- Only archive if there's existing content that differs from new content
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
      'Report updated (finalized) - version ' || next_version
    );

    -- Increment current_version
    NEW.current_version := next_version + 1;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
