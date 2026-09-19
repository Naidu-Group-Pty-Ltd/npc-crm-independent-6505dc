-- The template converter: brand design systems, and conversions.
--
-- Two tables. A brand design system is a saved position on the report design
-- system; a conversion is one uploaded template turned into a document under
-- one of those systems and bound to a report format.

-- ── Brand design systems ────────────────────────────────────────────────────
--
-- Stores the *inputs*, never the resolved palette.
--
-- A resolved palette is derived against the preset's paper grounds, and presets
-- disagree about those — `minimal_ink` has a champagne alternate where
-- `signature` has ivory. A stored `accentOnPaper` derived under one preset is
-- not legal under another, which is a bug `brandResolve.pure.ts` already
-- records having shipped once. So the row holds the brand hex and the options,
-- and `resolveReportPalette` runs at render time, every time.

CREATE TABLE IF NOT EXISTS public.brand_design_systems (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  name text NOT NULL,
  -- Unique so a system can be referenced by a stable handle rather than a uuid
  -- in a URL somebody pastes into chat.
  slug text NOT NULL UNIQUE,
  description text NOT NULL DEFAULT '',

  -- `#RRGGBB`, or null for the house brand. Checked here as well as in the
  -- reader: this column feeds a renderer, and a malformed hex reaching
  -- `resolveReportPalette` is silently ignored there, which would ship a
  -- document in the wrong colour with nothing to explain it.
  brand_hex text CHECK (brand_hex IS NULL OR brand_hex ~ '^#[0-9A-Fa-f]{6}$'),

  -- The full `ReportDesignOptions`. One jsonb rather than ten columns because
  -- the shape is owned by `options.pure.ts` and normalised on read; splitting it
  -- would put the same contract in two places and let them drift.
  options jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- 'authored' or 'generated'. Worth a column: a system a model drafted and one
  -- a person built deserve different scrutiny on review, and once they are all
  -- in one list there is otherwise no way to tell them apart.
  origin text NOT NULL DEFAULT 'authored' CHECK (origin IN ('authored', 'generated')),
  -- The brief a generated system came from, so it can be regenerated rather
  -- than reverse-engineered.
  brief text NOT NULL DEFAULT '',

  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.custom_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.brand_design_systems IS
  'A saved position on the report design system: a brand colour plus a full ReportDesignOptions. The resolved palette is deliberately not stored — it is derived per render against the preset''s own grounds, because a palette resolved under one preset is not legal under another.';

CREATE INDEX IF NOT EXISTS brand_design_systems_active_idx
  ON public.brand_design_systems (is_active, updated_at DESC);

-- ── Conversions ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.template_conversions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  requested_by uuid REFERENCES public.custom_users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'extracting'
    CHECK (status IN ('extracting', 'review', 'rendering', 'succeeded', 'failed')),

  source_filename text NOT NULL DEFAULT '',
  source_size_bytes integer,
  -- The Markdown `parse-template-document` returned. Kept so a binding can be
  -- re-proposed and the document re-rendered without re-parsing the PDF, which
  -- is the slow and expensive half.
  source_markdown text,

  -- The extracted structure, and the binding a person confirmed. Both jsonb
  -- because both are owned by pure modules that validate on read.
  structure jsonb,
  binding jsonb,

  -- The report format this was bound to, as a `ReportArchetypeId`. Not a FK:
  -- archetypes live in code, not in a table, and inventing a table for them
  -- would make the code and the database two sources of one truth.
  bound_format text,

  design_system_id uuid REFERENCES public.brand_design_systems(id) ON DELETE SET NULL,

  -- What came out.
  file_name text NOT NULL DEFAULT '',
  storage_bucket text NOT NULL DEFAULT 'converted-templates',
  storage_path text,
  bytes integer,
  page_count integer,

  -- How much of the upload found a home.
  --
  -- `bound_chapters` is the number the format wanted and the template supplied;
  -- `unfilled_chapters` the format wanted and it did not; `appendix_sections`
  -- what the template had and the format had no place for. A conversion where
  -- the third number dwarfs the first is one where the wrong format was chosen,
  -- and that is the single most useful thing to be able to query.
  bound_chapters integer NOT NULL DEFAULT 0,
  unfilled_chapters integer NOT NULL DEFAULT 0,
  appendix_sections integer NOT NULL DEFAULT 0,
  -- True when the source had no headings, so nothing could be bound.
  unstructured boolean NOT NULL DEFAULT false,

  brand_snapshot_id uuid REFERENCES public.report_brand_snapshots(id) ON DELETE RESTRICT,
  duration_ms integer,
  error text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.template_conversions IS
  'One uploaded template converted onto the report design system and bound to a report format. Holds the parsed Markdown so a binding can be re-proposed and re-rendered without re-parsing the source PDF.';

CREATE INDEX IF NOT EXISTS template_conversions_requester_idx
  ON public.template_conversions (requested_by, created_at DESC);
CREATE INDEX IF NOT EXISTS template_conversions_failed_idx
  ON public.template_conversions (created_at DESC)
  WHERE status = 'failed';
-- "Which conversions were bound to a format that had no place for most of the
-- upload?" — the question the appendix count exists to answer.
CREATE INDEX IF NOT EXISTS template_conversions_appendix_idx
  ON public.template_conversions (created_at DESC)
  WHERE appendix_sections > 0;
CREATE INDEX IF NOT EXISTS template_conversions_system_idx
  ON public.template_conversions (design_system_id)
  WHERE design_system_id IS NOT NULL;

-- ── The bucket ──────────────────────────────────────────────────────────────
--
-- Private, and its own.
--
-- Not `report-templates`, where the Template Builder's assets go: that bucket
-- is public, and its public-ness is load-bearing — asset URLs are embedded in
-- saved template JSON. A converted draft carries whatever prose was in
-- somebody's uploaded template, which does not belong behind a guessable public
-- URL.
--
-- Not `template-import-artifacts` either, private though it is: that bucket
-- belongs to the PDF import subsystem, whose monitoring reports any object it
-- cannot tie to an import as an orphan. Borrowing it would create a standing
-- false alarm.

INSERT INTO storage.buckets (id, name, public)
VALUES ('converted-templates', 'converted-templates', false)
ON CONFLICT (id) DO NOTHING;

-- Reads go through the render route's signed URLs, which are issued by the
-- service role. Nothing authenticated needs direct object access, so nothing
-- authenticated is granted it.
CREATE POLICY "Service role manages converted templates"
  ON storage.objects FOR ALL
  TO service_role
  USING (bucket_id = 'converted-templates')
  WITH CHECK (bucket_id = 'converted-templates');

-- ── Access ──────────────────────────────────────────────────────────────────
--
-- Both tables are Template Builder furniture, governed by the `templates`
-- module the page itself is guarded by. A design system carries no client data;
-- a conversion carries whatever was in the uploaded template, which is why its
-- read policy is the narrower of the two.

ALTER TABLE public.brand_design_systems ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.template_conversions ENABLE ROW LEVEL SECURITY;

-- A design system is chosen from a picker by anyone who can render a report, so
-- it is readable by any authenticated user and writable only by service role.
CREATE POLICY brand_design_systems_select
  ON public.brand_design_systems
  FOR SELECT TO authenticated
  USING (true);

-- A conversion is readable by whoever asked for it, and by superadmins.
CREATE POLICY template_conversions_select
  ON public.template_conversions
  FOR SELECT TO authenticated
  USING (requested_by = auth.uid() OR public.has_role(auth.uid(), 'superadmin'));

REVOKE ALL ON public.brand_design_systems FROM anon, authenticated;
REVOKE ALL ON public.template_conversions FROM anon, authenticated;
GRANT SELECT ON public.brand_design_systems TO authenticated;
GRANT SELECT ON public.template_conversions TO authenticated;
GRANT ALL ON public.brand_design_systems TO service_role;
GRANT ALL ON public.template_conversions TO service_role;
