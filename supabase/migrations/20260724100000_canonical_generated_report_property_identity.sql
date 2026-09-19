-- Canonical identity for Generated Reports property packages. This migration
-- preserves all report rows/files/lineage and only repairs the grouping key.
ALTER TABLE public.investment_reports
  ADD COLUMN IF NOT EXISTS canonical_property_key text;

CREATE OR REPLACE FUNCTION public.canonical_report_address_key(raw_address text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT NULLIF(
    regexp_replace(lower(trim(coalesce(raw_address, ''))), '[^a-z0-9]+', ' ', 'g'),
    ''
  );
$$;

CREATE OR REPLACE FUNCTION public.resolve_investment_report_property_key(
  p_listing_id text,
  p_client_property_id uuid,
  p_address text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN NULLIF(trim(p_listing_id), '') IS NOT NULL THEN 'listing:' || trim(p_listing_id)
    WHEN p_client_property_id IS NOT NULL THEN 'client:' || p_client_property_id::text
    WHEN public.canonical_report_address_key(p_address) IS NOT NULL THEN 'address:' || public.canonical_report_address_key(p_address)
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION public.set_investment_report_property_identity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  inherited_key text;
BEGIN
  -- A derivative must inherit its source's identity even when a legacy path
  -- supplies a different listing ID or cosmetic address variation.
  IF NEW.derived_from_report_id IS NOT NULL OR NEW.parent_report_id IS NOT NULL THEN
    SELECT canonical_property_key INTO inherited_key
    FROM public.investment_reports
    WHERE id = COALESCE(NEW.derived_from_report_id, NEW.parent_report_id);
  END IF;

  NEW.canonical_property_key := COALESCE(
    inherited_key,
    public.resolve_investment_report_property_key(NEW.property_listing_id, NEW.client_property_id, NEW.property_address)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_investment_report_property_identity ON public.investment_reports;
CREATE TRIGGER set_investment_report_property_identity
BEFORE INSERT OR UPDATE OF property_listing_id, client_property_id, property_address, derived_from_report_id, parent_report_id
ON public.investment_reports
FOR EACH ROW EXECUTE FUNCTION public.set_investment_report_property_identity();

-- Backfill in a single statement. Recursive lineage resolves to its root;
-- no reports, versions, files, grades, timestamps, or audit columns are
-- deleted/rewritten. Re-running produces the same values.
WITH RECURSIVE lineage AS (
  SELECT r.id, r.id AS root_id, r.derived_from_report_id, r.parent_report_id, ARRAY[r.id] AS path
  FROM public.investment_reports r
  UNION ALL
  SELECT lineage.id, parent.id AS root_id, parent.derived_from_report_id, parent.parent_report_id, lineage.path || parent.id
  FROM lineage
  JOIN public.investment_reports parent
    ON parent.id = COALESCE(lineage.derived_from_report_id, lineage.parent_report_id)
  WHERE NOT parent.id = ANY(lineage.path)
), roots AS (
  SELECT DISTINCT ON (id) id, root_id
  FROM lineage
  WHERE derived_from_report_id IS NULL AND parent_report_id IS NULL
  ORDER BY id
)
UPDATE public.investment_reports report
SET canonical_property_key = public.resolve_investment_report_property_key(
  root.property_listing_id, root.client_property_id, root.property_address
)
FROM roots
JOIN public.investment_reports root ON root.id = roots.root_id
WHERE report.id = roots.id
  AND report.canonical_property_key IS DISTINCT FROM public.resolve_investment_report_property_key(
    root.property_listing_id, root.client_property_id, root.property_address
  );

CREATE INDEX IF NOT EXISTS idx_investment_reports_canonical_property_key
  ON public.investment_reports (canonical_property_key)
  WHERE canonical_property_key IS NOT NULL;

COMMENT ON COLUMN public.investment_reports.canonical_property_key IS
  'Server-resolved property identity: lineage root listing/client record, then conservative normalized address fallback.';
