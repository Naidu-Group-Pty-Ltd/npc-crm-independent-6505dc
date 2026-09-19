-- Generated Reports comparisons are homogeneous by persisted report_tier.
-- This protects direct table writes as well as the edge-function workflow.
ALTER TABLE public.property_comparisons
  ADD COLUMN IF NOT EXISTS comparison_type text;

ALTER TABLE public.property_comparisons
  DROP CONSTRAINT IF EXISTS property_comparisons_comparison_type_check;

ALTER TABLE public.property_comparisons
  ADD CONSTRAINT property_comparisons_comparison_type_check
  CHECK (comparison_type IS NULL OR comparison_type IN ('compass', 'financial', 'strategic', 'snapshot', 'briefing'));

CREATE OR REPLACE FUNCTION public.validate_property_comparison_report_types()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  resolved_types text[];
  resolved_type text;
BEGIN
  IF NEW.report_ids IS NULL OR cardinality(NEW.report_ids) < 2 OR cardinality(NEW.report_ids) > 5 THEN
    RAISE EXCEPTION 'A comparison requires between 2 and 5 reports' USING ERRCODE = '22023';
  END IF;

  IF cardinality(NEW.report_ids) <> cardinality(ARRAY(SELECT DISTINCT id FROM unnest(NEW.report_ids) AS id)) THEN
    RAISE EXCEPTION 'A comparison cannot contain duplicate reports' USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(report_tier), min(report_tier)
    INTO resolved_types, resolved_type
  FROM public.investment_reports
  WHERE id::text = ANY(NEW.report_ids)
    AND is_archived IS NOT TRUE
    AND status = 'completed';

  IF cardinality(resolved_types) <> cardinality(NEW.report_ids) THEN
    RAISE EXCEPTION 'Every comparison report must be active and completed' USING ERRCODE = '22023';
  END IF;

  IF cardinality(ARRAY(SELECT DISTINCT type FROM unnest(resolved_types) AS type)) <> 1
     OR resolved_type NOT IN ('compass', 'financial', 'strategic', 'snapshot', 'briefing') THEN
    RAISE EXCEPTION 'Selected reports must all be the same report type' USING ERRCODE = '22023';
  END IF;

  IF NEW.comparison_type IS NOT NULL AND NEW.comparison_type <> resolved_type THEN
    RAISE EXCEPTION 'Comparison type does not match selected reports' USING ERRCODE = '22023';
  END IF;

  NEW.comparison_type := resolved_type;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_property_comparison_report_types ON public.property_comparisons;
CREATE TRIGGER validate_property_comparison_report_types
  BEFORE INSERT OR UPDATE OF report_ids, comparison_type ON public.property_comparisons
  FOR EACH ROW EXECUTE FUNCTION public.validate_property_comparison_report_types();

COMMENT ON COLUMN public.property_comparisons.comparison_type IS
  'Canonical report_tier shared by all source reports in this comparison.';
