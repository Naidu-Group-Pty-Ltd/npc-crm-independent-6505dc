-- Restore parent_report_id as the fallback when the preferred derived report
-- does not provide a canonical property identity.
CREATE OR REPLACE FUNCTION public.set_investment_report_property_identity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  inherited_key text;
BEGIN
  IF NEW.derived_from_report_id IS NOT NULL THEN
    SELECT canonical_property_key INTO inherited_key
    FROM public.investment_reports
    WHERE id = NEW.derived_from_report_id;
  END IF;

  IF inherited_key IS NULL AND NEW.parent_report_id IS NOT NULL THEN
    SELECT canonical_property_key INTO inherited_key
    FROM public.investment_reports
    WHERE id = NEW.parent_report_id;
  END IF;

  NEW.canonical_property_key := COALESCE(
    inherited_key,
    public.resolve_investment_report_property_key(
      NEW.property_listing_id,
      NEW.client_property_id,
      NEW.property_address
    )
  );
  RETURN NEW;
END;
$$;

-- Re-evaluate existing lineage through both links. A derived lineage remains
-- preferred, but a parent lineage can supply the key when that branch cannot.
WITH RECURSIVE lineage AS (
  (
    SELECT
      report.id,
      report.derived_from_report_id AS ancestor_id,
      ARRAY[report.id] AS visited,
      ARRAY[1] AS priority_path,
      1 AS depth
    FROM public.investment_reports report
    WHERE report.derived_from_report_id IS NOT NULL

    UNION ALL

    SELECT
      report.id,
      report.parent_report_id,
      ARRAY[report.id],
      ARRAY[2],
      1
    FROM public.investment_reports report
    WHERE report.parent_report_id IS NOT NULL
  )

  UNION ALL

  SELECT
    lineage.id,
    next_ancestor.ancestor_id,
    lineage.visited || ancestor.id,
    lineage.priority_path || next_ancestor.priority,
    lineage.depth + 1
  FROM lineage
  JOIN public.investment_reports ancestor ON ancestor.id = lineage.ancestor_id
  CROSS JOIN LATERAL (
    VALUES
      (ancestor.derived_from_report_id, 1),
      (ancestor.parent_report_id, 2)
  ) AS next_ancestor(ancestor_id, priority)
  WHERE next_ancestor.ancestor_id IS NOT NULL
    AND NOT next_ancestor.ancestor_id = ANY(lineage.visited || ancestor.id)
    -- Report lineage is expected to be shallow. Keep the migration's work
    -- bounded even if both links form a deliberately branching graph.
    AND lineage.depth < 8
), inherited_keys AS (
  SELECT DISTINCT ON (lineage.id)
    lineage.id,
    ancestor.canonical_property_key
  FROM lineage
  JOIN public.investment_reports ancestor ON ancestor.id = lineage.ancestor_id
  WHERE ancestor.canonical_property_key IS NOT NULL
  ORDER BY lineage.id, lineage.priority_path
)
UPDATE public.investment_reports report
SET canonical_property_key = COALESCE(
  inherited_keys.canonical_property_key,
  public.resolve_investment_report_property_key(
    report.property_listing_id,
    report.client_property_id,
    report.property_address
  )
)
FROM inherited_keys
WHERE report.id = inherited_keys.id
  AND report.canonical_property_key IS DISTINCT FROM COALESCE(
    inherited_keys.canonical_property_key,
    public.resolve_investment_report_property_key(
      report.property_listing_id,
      report.client_property_id,
      report.property_address
    )
  );
