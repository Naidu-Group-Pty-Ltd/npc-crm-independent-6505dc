-- Brand snapshots for generated reports.
--
-- A report is a dated artefact. A client asking to re-issue the assessment they
-- were given eighteen months ago must receive the same document — not one
-- wearing whatever the tenant's branding happens to be today, and not one
-- missing its logo because the bucket has since been rotated. Pinning the brand
-- values at generation time is the only way that holds.
--
-- The precedent is `client_fact_find_brand_snapshots` (migration 20260801120000)
-- with `client_fact_find_outputs.branding_snapshot_id ON DELETE RESTRICT`. This
-- generalises it with one change: snapshots are deduplicated by content
-- fingerprint rather than written one-per-artefact. A tenant's brand changes a
-- handful of times a year and renders thousands of reports; a row per render is
-- thousands of identical rows.
--
-- Shape and fingerprint are produced by
-- `supabase/functions/_shared/reportDesign/snapshot.pure.ts`. The payload is
-- jsonb rather than columns because it carries base64 logo data URIs and a
-- versioned nested shape — `snapshot_version` is what a reader checks before
-- trusting the mapping, and it is a real column so a query can find stale rows.

CREATE TABLE public.report_brand_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 64-bit FNV-1a of the canonical payload, from `snapshotFingerprint()`.
  -- UNIQUE is the dedupe: writing an unchanged brand returns the existing row.
  -- It is a change detector, not a security primitive — a collision costs a
  -- reused row, never a forged document.
  fingerprint text NOT NULL UNIQUE CHECK (fingerprint ~ '^[0-9a-f]{16}$'),

  -- `REPORT_SNAPSHOT_VERSION`. Bumped when the shape changes in a way that makes
  -- an old row unreadable, so a reader can refuse rather than mis-map it.
  snapshot_version smallint NOT NULL CHECK (snapshot_version > 0),

  -- The `ReportBrandSnapshot`. Constrained to an object so a malformed write
  -- fails here rather than at render time.
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),

  -- Denormalised for support queries ("which reports carry the old ABN?").
  -- Never read by the renderer, which uses `payload` alone.
  company_name text NOT NULL DEFAULT '',
  brand_hex text CHECK (brand_hex IS NULL OR brand_hex ~ '^#[0-9A-Fa-f]{6}$'),

  -- SET NULL rather than CASCADE: deleting a white-label row must not delete the
  -- evidence of what a client was sent.
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

-- The artefact side of the link.
--
-- Nullable: every existing row predates snapshotting and there is nothing
-- truthful to backfill — inventing a snapshot from today's brand would assert
-- the report carried branding it did not. ON DELETE RESTRICT so a snapshot that
-- is still referenced cannot be removed, which is the whole point of pinning.
ALTER TABLE public.investment_reports
  ADD COLUMN IF NOT EXISTS brand_snapshot_id uuid
  REFERENCES public.report_brand_snapshots(id) ON DELETE RESTRICT;

COMMENT ON COLUMN public.investment_reports.brand_snapshot_id IS
  'Brand state this report was rendered with. NULL for reports generated before snapshotting; populated by the render path from the migration phase onward.';

CREATE INDEX IF NOT EXISTS investment_reports_brand_snapshot_idx
  ON public.investment_reports (brand_snapshot_id)
  WHERE brand_snapshot_id IS NOT NULL;

-- ── Access ──────────────────────────────────────────────────────────────────
--
-- A snapshot carries the issuing company's public contact details and its logo.
-- It carries no client data, so any authenticated staff member may read one —
-- they need to, to render a preview. Writes are service-role only: a snapshot is
-- created by the render path, and a snapshot a user can edit is not a record of
-- what was sent.

ALTER TABLE public.report_brand_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY report_brand_snapshots_select
  ON public.report_brand_snapshots
  FOR SELECT TO authenticated
  USING (true);

REVOKE ALL ON public.report_brand_snapshots FROM anon, authenticated;
GRANT SELECT ON public.report_brand_snapshots TO authenticated;
GRANT ALL ON public.report_brand_snapshots TO service_role;

-- ── Upsert ──────────────────────────────────────────────────────────────────
--
-- The dedupe read-then-write is a race: two concurrent renders of the same
-- unchanged brand both miss and both insert, and one gets a unique violation.
-- Doing it in one statement removes the race and the round trip.
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
  -- An existing row wins. The fingerprint covers the whole payload, so a
  -- matching fingerprint means a matching brand; rewriting it would only churn
  -- `created_at` and lose the date the brand state was first seen.
  ON CONFLICT (fingerprint) DO UPDATE SET fingerprint = EXCLUDED.fingerprint
  RETURNING id INTO snapshot_id;

  RETURN snapshot_id;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_report_brand_snapshot(text, smallint, jsonb, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_report_brand_snapshot(text, smallint, jsonb, text, text, uuid) TO service_role;
