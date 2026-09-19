
-- write-role helper
CREATE OR REPLACE FUNCTION public.has_aml_write_role(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, aml AS $$
  SELECT EXISTS (
    SELECT 1 FROM aml.role_assignments
    WHERE user_id = _user_id
      AND revoked_at IS NULL
      AND role IN ('analyst','reviewer','mlro')
  );
$$;
GRANT EXECUTE ON FUNCTION public.has_aml_write_role(uuid) TO authenticated, service_role;

-- Enums
DO $$ BEGIN CREATE TYPE aml.entity_type AS ENUM ('company','trust','smsf','partnership','sole_trader','other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE aml.control_type AS ENUM ('shareholding','trustee','beneficiary','appointor','director','partner','settlor','other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE aml.verification_state AS ENUM ('unverified','pending','verified','failed','waived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE aml.entity_link_role AS ENUM ('subject','owner','related','counterparty');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Entities
CREATE TABLE IF NOT EXISTS aml.entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type aml.entity_type NOT NULL,
  legal_name text NOT NULL,
  trading_name text,
  abn text, acn text, tfn_masked text,
  jurisdiction text NOT NULL DEFAULT 'AU',
  incorporation_date date,
  registered_address jsonb DEFAULT '{}'::jsonb,
  principal_place_of_business jsonb DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active',
  is_pep_linked boolean NOT NULL DEFAULT false,
  is_sanctioned boolean NOT NULL DEFAULT false,
  risk_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_aml_entities_abn ON aml.entities(abn);
CREATE INDEX IF NOT EXISTS idx_aml_entities_acn ON aml.entities(acn);
CREATE INDEX IF NOT EXISTS idx_aml_entities_legal_name ON aml.entities(lower(legal_name));

CREATE TABLE IF NOT EXISTS aml.beneficial_owners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES aml.entities(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  date_of_birth date,
  residential_country text NOT NULL DEFAULT 'AU',
  residential_address jsonb DEFAULT '{}'::jsonb,
  ownership_percent numeric(6,3) NOT NULL DEFAULT 0,
  control_type aml.control_type NOT NULL DEFAULT 'shareholding',
  is_ubo boolean NOT NULL DEFAULT false,
  is_pep boolean NOT NULL DEFAULT false,
  is_sanctioned boolean NOT NULL DEFAULT false,
  verification_state aml.verification_state NOT NULL DEFAULT 'unverified',
  identity_check_id uuid,
  screening_check_id uuid,
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_aml_bo_entity ON aml.beneficial_owners(entity_id);

CREATE TABLE IF NOT EXISTS aml.authorised_representatives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES aml.entities(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  role_title text NOT NULL,
  appointment_date date,
  cessation_date date,
  is_signatory boolean NOT NULL DEFAULT false,
  is_director boolean NOT NULL DEFAULT false,
  verification_state aml.verification_state NOT NULL DEFAULT 'unverified',
  identity_check_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_aml_reps_entity ON aml.authorised_representatives(entity_id);

CREATE TABLE IF NOT EXISTS aml.entity_case_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES aml.cases(id) ON DELETE CASCADE,
  entity_id uuid NOT NULL REFERENCES aml.entities(id) ON DELETE CASCADE,
  link_role aml.entity_link_role NOT NULL DEFAULT 'subject',
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, entity_id, link_role)
);
CREATE INDEX IF NOT EXISTS idx_aml_ecl_case ON aml.entity_case_links(case_id);
CREATE INDEX IF NOT EXISTS idx_aml_ecl_entity ON aml.entity_case_links(entity_id);

GRANT USAGE ON SCHEMA aml TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON aml.entities, aml.beneficial_owners, aml.authorised_representatives, aml.entity_case_links TO authenticated;
GRANT ALL ON aml.entities, aml.beneficial_owners, aml.authorised_representatives, aml.entity_case_links TO service_role;

ALTER TABLE aml.entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE aml.beneficial_owners ENABLE ROW LEVEL SECURITY;
ALTER TABLE aml.authorised_representatives ENABLE ROW LEVEL SECURITY;
ALTER TABLE aml.entity_case_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "aml_entities_read" ON aml.entities FOR SELECT TO authenticated USING (public.has_any_aml_role(auth.uid()));
CREATE POLICY "aml_entities_write" ON aml.entities FOR ALL TO authenticated
  USING (public.has_aml_write_role(auth.uid())) WITH CHECK (public.has_aml_write_role(auth.uid()));

CREATE POLICY "aml_bo_read" ON aml.beneficial_owners FOR SELECT TO authenticated USING (public.has_any_aml_role(auth.uid()));
CREATE POLICY "aml_bo_write" ON aml.beneficial_owners FOR ALL TO authenticated
  USING (public.has_aml_write_role(auth.uid())) WITH CHECK (public.has_aml_write_role(auth.uid()));

CREATE POLICY "aml_reps_read" ON aml.authorised_representatives FOR SELECT TO authenticated USING (public.has_any_aml_role(auth.uid()));
CREATE POLICY "aml_reps_write" ON aml.authorised_representatives FOR ALL TO authenticated
  USING (public.has_aml_write_role(auth.uid())) WITH CHECK (public.has_aml_write_role(auth.uid()));

CREATE POLICY "aml_ecl_read" ON aml.entity_case_links FOR SELECT TO authenticated USING (public.has_any_aml_role(auth.uid()));
CREATE POLICY "aml_ecl_write" ON aml.entity_case_links FOR ALL TO authenticated
  USING (public.has_aml_write_role(auth.uid())) WITH CHECK (public.has_aml_write_role(auth.uid()));

CREATE OR REPLACE FUNCTION aml.touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS aml_entities_touch ON aml.entities;
CREATE TRIGGER aml_entities_touch BEFORE UPDATE ON aml.entities FOR EACH ROW EXECUTE FUNCTION aml.touch_updated_at();
DROP TRIGGER IF EXISTS aml_bo_touch ON aml.beneficial_owners;
CREATE TRIGGER aml_bo_touch BEFORE UPDATE ON aml.beneficial_owners FOR EACH ROW EXECUTE FUNCTION aml.touch_updated_at();
DROP TRIGGER IF EXISTS aml_reps_touch ON aml.authorised_representatives;
CREATE TRIGGER aml_reps_touch BEFORE UPDATE ON aml.authorised_representatives FOR EACH ROW EXECUTE FUNCTION aml.touch_updated_at();
