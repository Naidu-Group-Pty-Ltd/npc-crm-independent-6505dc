-- Additive repair for environments where the original canonical identity migration
-- was absent or only partly applied. No report payload, lineage, archive, audit, or
-- storage data is deleted or replaced.
ALTER TABLE public.investment_reports ADD COLUMN IF NOT EXISTS canonical_property_key text;

CREATE OR REPLACE FUNCTION public.canonical_report_address_key(raw_address text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT NULLIF(regexp_replace(lower(trim(coalesce(raw_address, ''))), '[^a-z0-9]+', ' ', 'g'), '');
$$;

CREATE OR REPLACE FUNCTION public.resolve_investment_report_property_key(
  p_listing_id text, p_client_property_id uuid, p_address text
) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN NULLIF(trim(p_listing_id), '') IS NOT NULL THEN 'listing:' || trim(p_listing_id)
    WHEN p_client_property_id IS NOT NULL THEN 'client:' || p_client_property_id::text
    WHEN public.canonical_report_address_key(p_address) IS NOT NULL THEN 'address:' || public.canonical_report_address_key(p_address)
    ELSE NULL END;
$$;

CREATE OR REPLACE FUNCTION public.set_investment_report_property_identity()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE inherited_key text;
BEGIN
  IF NEW.derived_from_report_id IS NOT NULL THEN
    SELECT canonical_property_key INTO inherited_key FROM public.investment_reports WHERE id = NEW.derived_from_report_id;
  END IF;
  IF inherited_key IS NULL AND NEW.parent_report_id IS NOT NULL THEN
    SELECT canonical_property_key INTO inherited_key FROM public.investment_reports WHERE id = NEW.parent_report_id;
  END IF;
  NEW.canonical_property_key := COALESCE(inherited_key,
    public.resolve_investment_report_property_key(NEW.property_listing_id, NEW.client_property_id, NEW.property_address));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_investment_report_property_identity ON public.investment_reports;
CREATE TRIGGER set_investment_report_property_identity
BEFORE INSERT OR UPDATE OF property_listing_id, client_property_id, property_address, derived_from_report_id, parent_report_id
ON public.investment_reports FOR EACH ROW EXECUTE FUNCTION public.set_investment_report_property_identity();

-- Establish every row's own conservative identity first, then propagate known
-- lineage identities repeatedly. The bounded loop safely handles arbitrary legacy
-- lineage depth and terminates when no value changes.
UPDATE public.investment_reports r
SET canonical_property_key = public.resolve_investment_report_property_key(r.property_listing_id, r.client_property_id, r.property_address)
WHERE r.canonical_property_key IS NULL;

DO $$
DECLARE changed integer;
BEGIN
  LOOP
    UPDATE public.investment_reports child
    SET canonical_property_key = parent.canonical_property_key
    FROM public.investment_reports parent
    WHERE parent.id = COALESCE(child.derived_from_report_id, child.parent_report_id)
      AND parent.canonical_property_key IS NOT NULL
      AND child.canonical_property_key IS DISTINCT FROM parent.canonical_property_key;
    GET DIAGNOSTICS changed = ROW_COUNT;
    EXIT WHEN changed = 0;
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS idx_investment_reports_canonical_property_key
  ON public.investment_reports (canonical_property_key) WHERE canonical_property_key IS NOT NULL;

COMMENT ON COLUMN public.investment_reports.canonical_property_key IS
  'Server-resolved physical property identity: lineage, listing, client property, then identity-sensitive normalized full address.';
