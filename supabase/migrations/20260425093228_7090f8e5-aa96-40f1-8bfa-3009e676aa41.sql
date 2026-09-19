
-- ============================================================
-- GHL Marketing Assets Snapshot Tables
-- ============================================================

-- 1. Workflows (Automations)
CREATE TABLE public.ghl_workflows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ghl_workflow_id text NOT NULL UNIQUE,
  location_id text NOT NULL,
  name text NOT NULL,
  status text,
  version integer,
  trigger_summary text,
  step_count integer DEFAULT 0,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ghl_workflows_status ON public.ghl_workflows(status);
CREATE INDEX idx_ghl_workflows_location ON public.ghl_workflows(location_id);
CREATE INDEX idx_ghl_workflows_synced ON public.ghl_workflows(last_synced_at DESC);

-- 2. Forms / Quizzes / Surveys
CREATE TABLE public.ghl_forms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ghl_form_id text NOT NULL UNIQUE,
  location_id text NOT NULL,
  name text NOT NULL,
  form_type text NOT NULL DEFAULT 'form', -- 'form' | 'quiz' | 'survey'
  fields_count integer DEFAULT 0,
  submission_count integer DEFAULT 0,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ghl_forms_type ON public.ghl_forms(form_type);
CREATE INDEX idx_ghl_forms_location ON public.ghl_forms(location_id);
CREATE INDEX idx_ghl_forms_synced ON public.ghl_forms(last_synced_at DESC);

-- 3. Funnels
CREATE TABLE public.ghl_funnels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ghl_funnel_id text NOT NULL UNIQUE,
  location_id text NOT NULL,
  name text NOT NULL,
  status text,
  domain text,
  page_count integer DEFAULT 0,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ghl_funnels_status ON public.ghl_funnels(status);
CREATE INDEX idx_ghl_funnels_location ON public.ghl_funnels(location_id);

-- 4. Funnel Pages
CREATE TABLE public.ghl_funnel_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ghl_page_id text NOT NULL UNIQUE,
  ghl_funnel_id text NOT NULL,
  funnel_uuid uuid REFERENCES public.ghl_funnels(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text,
  full_url text,
  page_type text,
  position integer,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ghl_funnel_pages_funnel ON public.ghl_funnel_pages(ghl_funnel_id);
CREATE INDEX idx_ghl_funnel_pages_uuid ON public.ghl_funnel_pages(funnel_uuid);

-- 5. ID Mapping (old GHL ID -> new GHL ID for re-ingestion)
CREATE TABLE public.ghl_id_mapping (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_type text NOT NULL, -- 'workflow' | 'form' | 'funnel' | 'funnel_page' | 'pipeline' | 'stage' | 'contact' | 'opportunity'
  old_ghl_id text NOT NULL,
  new_ghl_id text,
  source_account_label text,
  target_account_label text,
  remapped_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (resource_type, old_ghl_id)
);

CREATE INDEX idx_ghl_id_mapping_type ON public.ghl_id_mapping(resource_type);
CREATE INDEX idx_ghl_id_mapping_new ON public.ghl_id_mapping(new_ghl_id) WHERE new_ghl_id IS NOT NULL;

-- ============================================================
-- Triggers: keep updated_at fresh
-- ============================================================
CREATE TRIGGER trg_ghl_workflows_updated_at
  BEFORE UPDATE ON public.ghl_workflows
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_ghl_forms_updated_at
  BEFORE UPDATE ON public.ghl_forms
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_ghl_funnels_updated_at
  BEFORE UPDATE ON public.ghl_funnels
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_ghl_funnel_pages_updated_at
  BEFORE UPDATE ON public.ghl_funnel_pages
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_ghl_id_mapping_updated_at
  BEFORE UPDATE ON public.ghl_id_mapping
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- RLS — admins/superadmins only (service role bypasses)
-- ============================================================
ALTER TABLE public.ghl_workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ghl_forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ghl_funnels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ghl_funnel_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ghl_id_mapping ENABLE ROW LEVEL SECURITY;

-- Helper inline policy expression: only admins/superadmins via has_role()
DO $$
BEGIN
  -- ghl_workflows
  EXECUTE 'CREATE POLICY "Admins manage ghl_workflows" ON public.ghl_workflows FOR ALL USING (public.has_role(auth.uid(), ''admin'') OR public.has_role(auth.uid(), ''superadmin'')) WITH CHECK (public.has_role(auth.uid(), ''admin'') OR public.has_role(auth.uid(), ''superadmin''))';

  -- ghl_forms
  EXECUTE 'CREATE POLICY "Admins manage ghl_forms" ON public.ghl_forms FOR ALL USING (public.has_role(auth.uid(), ''admin'') OR public.has_role(auth.uid(), ''superadmin'')) WITH CHECK (public.has_role(auth.uid(), ''admin'') OR public.has_role(auth.uid(), ''superadmin''))';

  -- ghl_funnels
  EXECUTE 'CREATE POLICY "Admins manage ghl_funnels" ON public.ghl_funnels FOR ALL USING (public.has_role(auth.uid(), ''admin'') OR public.has_role(auth.uid(), ''superadmin'')) WITH CHECK (public.has_role(auth.uid(), ''admin'') OR public.has_role(auth.uid(), ''superadmin''))';

  -- ghl_funnel_pages
  EXECUTE 'CREATE POLICY "Admins manage ghl_funnel_pages" ON public.ghl_funnel_pages FOR ALL USING (public.has_role(auth.uid(), ''admin'') OR public.has_role(auth.uid(), ''superadmin'')) WITH CHECK (public.has_role(auth.uid(), ''admin'') OR public.has_role(auth.uid(), ''superadmin''))';

  -- ghl_id_mapping
  EXECUTE 'CREATE POLICY "Admins manage ghl_id_mapping" ON public.ghl_id_mapping FOR ALL USING (public.has_role(auth.uid(), ''admin'') OR public.has_role(auth.uid(), ''superadmin'')) WITH CHECK (public.has_role(auth.uid(), ''admin'') OR public.has_role(auth.uid(), ''superadmin''))';
END $$;
