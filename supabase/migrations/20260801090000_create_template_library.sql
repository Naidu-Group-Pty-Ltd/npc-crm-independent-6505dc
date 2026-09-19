-- =====================================================================
-- Template Library — additive data foundation.
--
-- Library entries are CATALOGUE data. They are deliberately NOT rows in
-- public.report_templates, for two reasons proven in the existing code:
--
--   1. useReportTemplates() lists report_templates with no filter, so
--      library rows would appear as cards in the existing Builder tab.
--   2. resolve_report_template() selects
--         WHERE report_type = $1 AND is_active = true
--      so a library row would be one mis-set boolean away from becoming
--      the template used for live customer PDFs.
--
-- Keeping them in their own table makes both outcomes structurally
-- impossible rather than merely guarded. See
-- docs/architecture/adr/017-template-library-separation.md.
--
-- NOTHING in this migration alters an existing table, policy, index,
-- constraint, function or row. It is purely additive and reversible by
-- dropping the three tables it creates.
-- =====================================================================

-- ── Entries ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.template_library_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Stable across every version of the same template.
  family_id uuid NOT NULL DEFAULT gen_random_uuid(),
  slug text NOT NULL,
  version integer NOT NULL DEFAULT 1,

  name text NOT NULL,
  description text,
  long_description text,

  category text NOT NULL DEFAULT 'investment',
  report_type text,
  tier text,
  variant text,
  industry text[] NOT NULL DEFAULT ARRAY[]::text[],
  tags text[] NOT NULL DEFAULT ARRAY[]::text[],
  style text,

  orientation text NOT NULL DEFAULT 'portrait',
  page_size text NOT NULL DEFAULT 'A4',
  page_count integer NOT NULL DEFAULT 0,

  -- Same shape as report_templates.schema / .config / .custom_css so a
  -- working copy is a straight field-for-field transfer.
  schema jsonb NOT NULL DEFAULT '{"version":1,"tokens":{},"slots":{},"pages":[]}'::jsonb,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  custom_css text,
  engine text NOT NULL DEFAULT 'weasyprint',

  -- Trimmed page-1 schema for the SVG card thumbnail. Small enough to be
  -- returned by the list query; the full `schema` never is.
  preview_schema jsonb,
  -- Storage PATHS, never signed URLs: render-template-pdf issues 24-hour
  -- signed URLs, so a persisted URL would break the following day.
  thumbnail_path text,
  preview_image_paths text[] NOT NULL DEFAULT ARRAY[]::text[],

  supported_modules text[] NOT NULL DEFAULT ARRAY[]::text[],
  required_bindings text[] NOT NULL DEFAULT ARRAY[]::text[],
  brand_safe boolean NOT NULL DEFAULT false,
  production_ready boolean NOT NULL DEFAULT false,
  compatibility_version integer NOT NULL DEFAULT 1,

  status text NOT NULL DEFAULT 'draft',
  access_tier text NOT NULL DEFAULT 'standard',

  -- Audience scope. Only 'global' is reachable today: this deployment has
  -- no organisation/tenant/agency table, and report_templates.agency_id is
  -- an orphan column with no membership relation (see
  -- 20260726143000_scope_report_template_reads.sql). 'agency' is permitted
  -- by the CHECK so a future tenancy model needs no column change; until
  -- then nothing writes it and the read policy ignores it.
  visibility text NOT NULL DEFAULT 'global',
  agency_id uuid,

  -- The Builder template this entry was promoted from, if any.
  source_template_id uuid REFERENCES public.report_templates(id) ON DELETE SET NULL,

  -- A custom_users.id. Deliberately NOT named created_by: the
  -- report_templates.created_by column is a foreign key to auth.users,
  -- which this platform's custom-auth ids are not in — which is why
  -- TemplateBranchingDialog sets it to null. Reusing the name would
  -- invite the same trap.
  created_by_user_id uuid,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  deprecated_at timestamptz,

  usage_count integer NOT NULL DEFAULT 0,
  last_used_at timestamptz
);

DO $$ BEGIN
  ALTER TABLE public.template_library_entries
    ADD CONSTRAINT template_library_entries_status_check
    CHECK (status IN ('draft', 'in_review', 'published', 'deprecated', 'archived'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.template_library_entries
    ADD CONSTRAINT template_library_entries_category_check
    CHECK (category IN ('investment', 'suburb', 'postcode', 'statewide',
                        'comparison', 'cash_flow', 'client_form', 'compliance'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.template_library_entries
    ADD CONSTRAINT template_library_entries_orientation_check
    CHECK (orientation IN ('portrait', 'landscape'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.template_library_entries
    ADD CONSTRAINT template_library_entries_engine_check
    CHECK (engine IN ('jspdf', 'weasyprint'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.template_library_entries
    ADD CONSTRAINT template_library_entries_access_tier_check
    CHECK (access_tier IN ('standard', 'premium', 'enterprise'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.template_library_entries
    ADD CONSTRAINT template_library_entries_visibility_check
    CHECK (visibility IN ('global', 'agency'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.template_library_entries
    ADD CONSTRAINT template_library_entries_variant_check
    CHECK (variant IS NULL OR variant IN ('composite', 'financial', 'due_diligence'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS template_library_entries_slug_version_idx
  ON public.template_library_entries (slug, version);
CREATE INDEX IF NOT EXISTS template_library_entries_browse_idx
  ON public.template_library_entries (status, category, updated_at DESC);
CREATE INDEX IF NOT EXISTS template_library_entries_report_type_idx
  ON public.template_library_entries (status, report_type);
CREATE INDEX IF NOT EXISTS template_library_entries_family_idx
  ON public.template_library_entries (family_id, version DESC);
CREATE INDEX IF NOT EXISTS template_library_entries_tags_idx
  ON public.template_library_entries USING GIN (tags);
CREATE INDEX IF NOT EXISTS template_library_entries_industry_idx
  ON public.template_library_entries USING GIN (industry);

-- ── Lineage ──────────────────────────────────────────────────────────
-- Kept on the library side so report_templates never needs an ALTER.
CREATE TABLE IF NOT EXISTS public.template_library_instantiations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL REFERENCES public.template_library_entries(id) ON DELETE RESTRICT,
  -- The exact entry version copied. Copies are snapshots, never live links,
  -- so a later republish of the entry cannot change a saved design.
  entry_version_at_copy integer NOT NULL,
  -- SET NULL rather than CASCADE: deleting a working copy must not erase the
  -- usage history that produced it.
  template_id uuid REFERENCES public.report_templates(id) ON DELETE SET NULL,
  created_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS template_library_instantiations_entry_idx
  ON public.template_library_instantiations (entry_id, created_at DESC);
CREATE INDEX IF NOT EXISTS template_library_instantiations_template_idx
  ON public.template_library_instantiations (template_id)
  WHERE template_id IS NOT NULL;

-- ── Governance events ────────────────────────────────────────────────
-- template_audit_log.template_id is NOT NULL with an FK to report_templates,
-- so library-side actions (publish, deprecate, archive) cannot be recorded
-- there. Instantiation events still go to template_audit_log, because by
-- then a report_templates row exists to point at.
CREATE TABLE IF NOT EXISTS public.template_library_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL REFERENCES public.template_library_entries(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  entry_version integer,
  actor_id uuid,
  actor_name text,
  summary text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS template_library_events_entry_idx
  ON public.template_library_events (entry_id, created_at DESC);

-- ── Row level security ───────────────────────────────────────────────
ALTER TABLE public.template_library_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.template_library_instantiations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.template_library_events ENABLE ROW LEVEL SECURITY;

-- Read: published entries, to any authenticated user of this deployment.
-- The deployment is the tenant (whitelabel_settings is a singleton), so a
-- published entry is deployment-wide catalogue content by definition.
-- Drafts are reachable only through the service-role broker, which checks
-- superadmin first — the same control-plane pattern manage-templates uses
-- for agency-scoped templates.
DROP POLICY IF EXISTS "template_library_read_published" ON public.template_library_entries;
CREATE POLICY "template_library_read_published"
  ON public.template_library_entries
  FOR SELECT
  TO authenticated
  USING (status = 'published');

DROP POLICY IF EXISTS "template_library_service_role_all" ON public.template_library_entries;
CREATE POLICY "template_library_service_role_all"
  ON public.template_library_entries
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Lineage and events are service-role only. Clients never read or write
-- them directly; the broker returns whatever a caller is entitled to see.
DROP POLICY IF EXISTS "template_library_instantiations_service_role_all" ON public.template_library_instantiations;
CREATE POLICY "template_library_instantiations_service_role_all"
  ON public.template_library_instantiations
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "template_library_events_service_role_all" ON public.template_library_events;
CREATE POLICY "template_library_events_service_role_all"
  ON public.template_library_events
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Deliberately NO write grants to `authenticated` on any of the three
-- tables: every mutation goes through manage-template-library, which
-- verifies the session and checks superadmin before it touches a row.
GRANT SELECT ON public.template_library_entries TO authenticated;
GRANT ALL ON public.template_library_entries TO service_role;
GRANT ALL ON public.template_library_instantiations TO service_role;
GRANT ALL ON public.template_library_events TO service_role;

-- ── updated_at maintenance ───────────────────────────────────────────
-- update_updated_at_column() already exists (migration 20250827173834).
DROP TRIGGER IF EXISTS set_template_library_entries_updated_at ON public.template_library_entries;
CREATE TRIGGER set_template_library_entries_updated_at
  BEFORE UPDATE ON public.template_library_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.template_library_entries IS
  'Master catalogue of designed report templates. Never resolvable by resolve_report_template() and never listed by the Template Builder — "Use template" copies an entry into report_templates instead. See ADR 017.';
COMMENT ON COLUMN public.template_library_entries.visibility IS
  'Reserved for a future tenancy model. Only ''global'' is reachable: this deployment has no organisation/tenant/agency membership relation.';
COMMENT ON TABLE public.template_library_instantiations IS
  'Lineage from a library entry to a working copy in report_templates. Lives here so report_templates needs no schema change.';
