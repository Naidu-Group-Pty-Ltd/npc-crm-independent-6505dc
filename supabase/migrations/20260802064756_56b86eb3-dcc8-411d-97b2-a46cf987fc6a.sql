CREATE TABLE public.report_brand_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint text NOT NULL UNIQUE CHECK (fingerprint ~ '^[0-9a-f]{16}$'),
  snapshot_version smallint NOT NULL CHECK (snapshot_version > 0),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  company_name text NOT NULL DEFAULT '',
  brand_hex text CHECK (brand_hex IS NULL OR brand_hex ~ '^#[0-9A-Fa-f]{6}$'),
  source_whitelabel_setting_id uuid REFERENCES public.whitelabel_settings(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.report_brand_snapshots IS
  'Brand values frozen at report generation time, deduplicated by content fingerprint. See supabase/functions/_shared/reportDesign/snapshot.pure.ts.';
COMMENT ON COLUMN public.report_brand_snapshots.fingerprint IS
  '64-bit FNV-1a of the canonical payload. Dedupe key, not an integrity check.';
COMMENT ON COLUMN public.report_brand_snapshots.payload IS
  'The ReportBrandSnapshot, including inlined logo data URIs.';

CREATE INDEX report_brand_snapshots_created_idx
  ON public.report_brand_snapshots (created_at DESC);
CREATE INDEX report_brand_snapshots_source_idx
  ON public.report_brand_snapshots (source_whitelabel_setting_id)
  WHERE source_whitelabel_setting_id IS NOT NULL;

ALTER TABLE public.investment_reports
  ADD COLUMN IF NOT EXISTS brand_snapshot_id uuid
  REFERENCES public.report_brand_snapshots(id) ON DELETE RESTRICT;

COMMENT ON COLUMN public.investment_reports.brand_snapshot_id IS
  'Brand state this report was rendered with. NULL for reports generated before snapshotting; populated by the render path from the migration phase onward.';

CREATE INDEX IF NOT EXISTS investment_reports_brand_snapshot_idx
  ON public.investment_reports (brand_snapshot_id)
  WHERE brand_snapshot_id IS NOT NULL;

ALTER TABLE public.report_brand_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY report_brand_snapshots_select
  ON public.report_brand_snapshots
  FOR SELECT TO authenticated
  USING (true);

REVOKE ALL ON public.report_brand_snapshots FROM anon, authenticated;
GRANT SELECT ON public.report_brand_snapshots TO authenticated;
GRANT ALL ON public.report_brand_snapshots TO service_role;

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