
-- Feature flag
INSERT INTO public.feature_flags (key, value, description)
VALUES ('aml_ctf', '{"enabled": false}'::jsonb, 'Master switch for the AML/CTF tri-portal module. Off by default; enable per environment after Phase 14 launch checklist.')
ON CONFLICT (key) DO NOTHING;

-- Dedicated schema
CREATE SCHEMA IF NOT EXISTS aml;
GRANT USAGE ON SCHEMA aml TO authenticated, service_role;

-- Enums
DO $$ BEGIN
  CREATE TYPE aml.aml_role AS ENUM ('analyst', 'reviewer', 'mlro', 'auditor');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE aml.case_status AS ENUM (
    'draft','kyc_in_progress','kyc_complete','edd_required',
    'under_review','escalated_mlro','cleared','blocked','closed'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE aml.risk_rating AS ENUM ('low', 'medium', 'high', 'prohibited');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE aml.event_category AS ENUM (
    'case_created','status_changed','risk_rescored','document_added',
    'idv_result','pep_sanctions_hit','edd_note','mlro_decision','austrac_report','system'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Role assignments
CREATE TABLE IF NOT EXISTS aml.role_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role aml.aml_role NOT NULL,
  granted_by UUID REFERENCES auth.users(id),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON aml.role_assignments TO authenticated;
GRANT ALL ON aml.role_assignments TO service_role;
ALTER TABLE aml.role_assignments ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_aml_role(_user_id UUID, _role aml.aml_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, aml AS $$
  SELECT EXISTS (
    SELECT 1 FROM aml.role_assignments
    WHERE user_id = _user_id AND role = _role AND revoked_at IS NULL
  );
$$;

CREATE OR REPLACE FUNCTION public.has_any_aml_role(_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, aml AS $$
  SELECT EXISTS (
    SELECT 1 FROM aml.role_assignments
    WHERE user_id = _user_id AND revoked_at IS NULL
  );
$$;

GRANT EXECUTE ON FUNCTION public.has_aml_role(UUID, aml.aml_role) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.has_any_aml_role(UUID) TO authenticated, anon;

CREATE POLICY "MLRO manages AML role assignments"
ON aml.role_assignments FOR ALL TO authenticated
USING (public.has_aml_role(auth.uid(), 'mlro'))
WITH CHECK (public.has_aml_role(auth.uid(), 'mlro'));

CREATE POLICY "Users see their own AML role rows"
ON aml.role_assignments FOR SELECT TO authenticated
USING (user_id = auth.uid());

-- Cases
CREATE TABLE IF NOT EXISTS aml.cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_reference TEXT NOT NULL UNIQUE,
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  purchase_file_id UUID REFERENCES public.purchase_files(id) ON DELETE SET NULL,
  subject_type TEXT NOT NULL DEFAULT 'individual',
  subject_display_name TEXT NOT NULL,
  status aml.case_status NOT NULL DEFAULT 'draft',
  risk_rating aml.risk_rating,
  risk_score NUMERIC(6,2),
  assigned_analyst_id UUID REFERENCES auth.users(id),
  assigned_mlro_id UUID REFERENCES auth.users(id),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_aml_cases_client ON aml.cases(client_id);
CREATE INDEX IF NOT EXISTS idx_aml_cases_pf ON aml.cases(purchase_file_id);
CREATE INDEX IF NOT EXISTS idx_aml_cases_status ON aml.cases(status);
CREATE INDEX IF NOT EXISTS idx_aml_cases_risk ON aml.cases(risk_rating);
CREATE INDEX IF NOT EXISTS idx_aml_cases_analyst ON aml.cases(assigned_analyst_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON aml.cases TO authenticated;
GRANT ALL ON aml.cases TO service_role;
ALTER TABLE aml.cases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "AML staff read cases"
ON aml.cases FOR SELECT TO authenticated
USING (public.has_any_aml_role(auth.uid()));

CREATE POLICY "Analysts and MLRO insert cases"
ON aml.cases FOR INSERT TO authenticated
WITH CHECK (public.has_aml_role(auth.uid(), 'analyst') OR public.has_aml_role(auth.uid(), 'mlro'));

CREATE POLICY "Analysts/MLRO update cases"
ON aml.cases FOR UPDATE TO authenticated
USING (public.has_aml_role(auth.uid(), 'analyst') OR public.has_aml_role(auth.uid(), 'reviewer') OR public.has_aml_role(auth.uid(), 'mlro'))
WITH CHECK (public.has_aml_role(auth.uid(), 'analyst') OR public.has_aml_role(auth.uid(), 'reviewer') OR public.has_aml_role(auth.uid(), 'mlro'));

CREATE POLICY "Only MLRO deletes cases"
ON aml.cases FOR DELETE TO authenticated
USING (public.has_aml_role(auth.uid(), 'mlro'));

-- Case events (immutable audit log)
CREATE TABLE IF NOT EXISTS aml.case_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES aml.cases(id) ON DELETE CASCADE,
  category aml.event_category NOT NULL,
  summary TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor_id UUID REFERENCES auth.users(id),
  actor_label TEXT,
  prev_hash TEXT,
  row_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_aml_case_events_case ON aml.case_events(case_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_aml_case_events_category ON aml.case_events(category);

GRANT SELECT, INSERT ON aml.case_events TO authenticated;
GRANT ALL ON aml.case_events TO service_role;
ALTER TABLE aml.case_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "AML staff read case events"
ON aml.case_events FOR SELECT TO authenticated
USING (public.has_any_aml_role(auth.uid()));

CREATE POLICY "AML staff append case events"
ON aml.case_events FOR INSERT TO authenticated
WITH CHECK (public.has_aml_role(auth.uid(), 'analyst') OR public.has_aml_role(auth.uid(), 'reviewer') OR public.has_aml_role(auth.uid(), 'mlro'));

-- updated_at triggers
DROP TRIGGER IF EXISTS trg_aml_cases_updated_at ON aml.cases;
CREATE TRIGGER trg_aml_cases_updated_at
BEFORE UPDATE ON aml.cases
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_aml_role_assignments_updated_at ON aml.role_assignments;
CREATE TRIGGER trg_aml_role_assignments_updated_at
BEFORE UPDATE ON aml.role_assignments
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Realtime
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE aml.cases;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE aml.case_events;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
