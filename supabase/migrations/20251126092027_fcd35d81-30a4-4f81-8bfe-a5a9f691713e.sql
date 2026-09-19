-- Phase 3: Report Versioning & Changelog Tracking

-- Create report_versions table to track all versions of a report
CREATE TABLE IF NOT EXISTS public.report_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES public.investment_reports(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  report_content TEXT NOT NULL,
  sources_content TEXT,
  property_specs JSONB,
  validation_flags JSONB DEFAULT '[]'::jsonb,
  data_sources JSONB DEFAULT '{}'::jsonb,
  financial_calculations JSONB,
  investment_score JSONB,
  location_intelligence JSONB,
  demographics_data JSONB,
  economic_data JSONB,
  calculation_version VARCHAR(10),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  created_by UUID,
  changelog TEXT,
  quality_score INTEGER,
  
  -- Ensure unique version numbers per report
  UNIQUE(report_id, version_number)
);

-- Create index for faster version lookups
CREATE INDEX idx_report_versions_report_id ON public.report_versions(report_id);
CREATE INDEX idx_report_versions_created_at ON public.report_versions(created_at DESC);

-- Enable RLS on report_versions
ALTER TABLE public.report_versions ENABLE ROW LEVEL SECURITY;

-- RLS Policies for report_versions
CREATE POLICY "All authenticated users can view all report versions"
  ON public.report_versions FOR SELECT
  USING (true);

CREATE POLICY "Service role can manage report versions"
  ON public.report_versions FOR ALL
  USING (true);

-- Function to archive current report as a version before regeneration
CREATE OR REPLACE FUNCTION public.archive_report_version()
RETURNS TRIGGER AS $$
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
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Create trigger to auto-archive versions on update
CREATE TRIGGER archive_before_regeneration
  BEFORE UPDATE OF report_content ON public.investment_reports
  FOR EACH ROW
  WHEN (OLD.report_content IS DISTINCT FROM NEW.report_content)
  EXECUTE FUNCTION public.archive_report_version();

-- Function to get version changelog/diff
CREATE OR REPLACE FUNCTION public.get_report_changelog(
  p_report_id UUID,
  p_version_from INTEGER DEFAULT NULL,
  p_version_to INTEGER DEFAULT NULL
)
RETURNS TABLE(
  version_number INTEGER,
  created_at TIMESTAMP WITH TIME ZONE,
  quality_score INTEGER,
  validation_count INTEGER,
  changelog TEXT,
  changes_summary JSONB
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    rv.version_number,
    rv.created_at,
    rv.quality_score,
    COALESCE(jsonb_array_length(rv.validation_flags), 0)::INTEGER as validation_count,
    rv.changelog,
    jsonb_build_object(
      'property_specs_changed', (rv.property_specs IS DISTINCT FROM LAG(rv.property_specs) OVER (ORDER BY rv.version_number)),
      'financial_data_changed', (rv.financial_calculations IS DISTINCT FROM LAG(rv.financial_calculations) OVER (ORDER BY rv.version_number)),
      'validation_flags_changed', (rv.validation_flags IS DISTINCT FROM LAG(rv.validation_flags) OVER (ORDER BY rv.version_number)),
      'content_length', length(rv.report_content),
      'data_sources_count', (SELECT COUNT(*) FROM jsonb_object_keys(rv.data_sources))
    ) as changes_summary
  FROM public.report_versions rv
  WHERE rv.report_id = p_report_id
    AND (p_version_from IS NULL OR rv.version_number >= p_version_from)
    AND (p_version_to IS NULL OR rv.version_number <= p_version_to)
  ORDER BY rv.version_number DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Add version tracking column to investment_reports
ALTER TABLE public.investment_reports 
ADD COLUMN IF NOT EXISTS current_version INTEGER DEFAULT 1;

-- Comment for documentation
COMMENT ON TABLE public.report_versions IS 'Stores historical versions of investment reports for changelog and comparison';
COMMENT ON FUNCTION public.archive_report_version() IS 'Automatically archives report version before regeneration';
COMMENT ON FUNCTION public.get_report_changelog(UUID, INTEGER, INTEGER) IS 'Retrieves version history and changelog for a report';