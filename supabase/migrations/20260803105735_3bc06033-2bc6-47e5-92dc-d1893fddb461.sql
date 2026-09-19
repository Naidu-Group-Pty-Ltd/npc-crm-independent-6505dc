CREATE OR REPLACE FUNCTION public.upsert_report_brand_snapshot(
  _fingerprint text,
  _snapshot_version smallint,
  _payload jsonb,
  _company_name text DEFAULT '',
  _brand_hex text DEFAULT NULL,
  _source_whitelabel_setting_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  snapshot_id uuid;
BEGIN
  INSERT INTO public.report_brand_snapshots (
    fingerprint, snapshot_version, payload, company_name, brand_hex,
    source_whitelabel_setting_id
  )
  VALUES (
    _fingerprint, _snapshot_version, _payload, COALESCE(_company_name, ''),
    _brand_hex, _source_whitelabel_setting_id
  )
  ON CONFLICT (fingerprint) DO UPDATE SET fingerprint = EXCLUDED.fingerprint
  RETURNING id INTO snapshot_id;

  RETURN snapshot_id;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_report_brand_snapshot(text, smallint, jsonb, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_report_brand_snapshot(text, smallint, jsonb, text, text, uuid) TO service_role;