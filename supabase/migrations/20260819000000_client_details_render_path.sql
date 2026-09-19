-- The Client Details report's render path.
--
-- One table: a record of what was sent, about whom, and under whose brand.
--
-- The client's details are deliberately **not** copied here. They are already
-- rows in nine tables and this document is a rendering of them, so a snapshot in
-- the ledger would be a second answer to "what does the record say" — the
-- failure mode this programme removes rather than adds. The same reasoning
-- `20260815000000_cash_flow_render_path.sql` gives for the projection.
--
-- What is worth keeping is the artefact and the shape of the record it came
-- from: which file was produced, for which client, by whom, under which pinned
-- brand, how much of the record had anything in it, and — when it failed — why.

CREATE TABLE IF NOT EXISTS public.client_details_renders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- CASCADE: the document is *about* the client, so a deleted client has no
  -- render worth keeping.
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  requested_by uuid REFERENCES public.custom_users(id) ON DELETE SET NULL,

  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'succeeded', 'failed')),

  -- What the client received.
  file_name text NOT NULL DEFAULT '',
  storage_bucket text NOT NULL DEFAULT 'client-files',
  storage_path text,
  bytes integer,

  -- How many holdings the document covered.
  --
  -- Recorded because it answers the question this format was redesigned around.
  -- Measured before the work: 771 clients hold 53 properties between them, and
  -- **26 clients account for all of them**. The generator being replaced opens
  -- on a portfolio summary, so for 745 clients it leads with several pages of
  -- nothing. This column is how anyone checks whether that ratio still holds.
  property_count integer NOT NULL DEFAULT 0,

  -- Which sections the record actually had content for.
  --
  -- Almost every section of this document is conditional, so two renders of two
  -- clients are legitimately different documents. When someone asks why one
  -- client's file is five pages and another's is twenty-six, this answers it
  -- without re-rendering either.
  sections_included text[] NOT NULL DEFAULT '{}',

  -- The brand it was issued under. RESTRICT for the same reason the snapshot
  -- table uses it: a pinned brand that is still referenced cannot be removed.
  brand_snapshot_id uuid REFERENCES public.report_brand_snapshots(id) ON DELETE RESTRICT,

  -- What the brand snapshot was missing, from `auditSnapshot()`. Advisory:
  -- rendering does not stop for a missing ABN, but a support question about a
  -- document with no ABN on it has an answer here.
  brand_gaps text[] NOT NULL DEFAULT '{}',

  duration_ms integer,
  error text,

  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.client_details_renders IS
  'One row per Client Details render: what was produced, about which client, how much of that client''s record had content, and under which brand snapshot. Written by render-client-details-pdf. The client''s details are not copied here — see the migration header for why.';

CREATE INDEX IF NOT EXISTS client_details_renders_client_idx
  ON public.client_details_renders (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS client_details_renders_brand_idx
  ON public.client_details_renders (brand_snapshot_id)
  WHERE brand_snapshot_id IS NOT NULL;
-- Support queries start from "which renders failed today".
CREATE INDEX IF NOT EXISTS client_details_renders_failed_idx
  ON public.client_details_renders (created_at DESC)
  WHERE status = 'failed';
-- "How many of the documents we send have any portfolio in them at all?" is the
-- question the format's whole structure turns on, and it should be one query.
CREATE INDEX IF NOT EXISTS client_details_renders_portfolio_idx
  ON public.client_details_renders (property_count, created_at DESC);

-- ── Access ──────────────────────────────────────────────────────────────────
--
-- A render row points at a file containing a named person's income, debts,
-- expenses and property — the most sensitive document this programme produces.
-- The route that writes it gates on the `client_management / can_view` module
-- permission *and* on `canAccessClient`; the read policy below is the narrowest
-- rule available, because a row here is evidence and superadmins are who audit
-- it.

ALTER TABLE public.client_details_renders ENABLE ROW LEVEL SECURITY;

CREATE POLICY client_details_renders_select
  ON public.client_details_renders
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'superadmin'));

REVOKE ALL ON public.client_details_renders FROM anon, authenticated;
GRANT SELECT ON public.client_details_renders TO authenticated;
GRANT ALL ON public.client_details_renders TO service_role;
