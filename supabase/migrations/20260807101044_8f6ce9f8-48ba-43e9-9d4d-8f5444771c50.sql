CREATE TABLE IF NOT EXISTS aml.partner_organisations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL DEFAULT 'default',
  legal_name text NOT NULL CHECK (btrim(legal_name) <> ''),
  trading_name text,
  abn text,
  registration_reference text,
  registration_country text NOT NULL DEFAULT 'AU',
  organisation_type text NOT NULL CHECK (organisation_type IN
    ('finance', 'builder', 'developer', 'solicitor_conveyancer', 'other')),
  portal_types text[] NOT NULL DEFAULT ARRAY[]::text[],
  reporting_entity_classification text NOT NULL DEFAULT 'unclassified'
    CHECK (reporting_entity_classification IN (
      'unclassified',
      'eligible_relying_reporting_entity',
      'eligible_foreign_equivalent',
      'reporting_entity_no_reliance',
      'non_reporting_commercial',
      'outsourcing_principal',
      'service_provider')),
  regulator_reference text,
  classification_status text NOT NULL DEFAULT 'unclassified'
    CHECK (classification_status IN ('unclassified', 'pending_review', 'classified', 'suspended')),
  classification_evidence_reference text,
  classification_notes text,
  verified_by uuid,
  verified_at timestamptz,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'ended')),
  -- [Phase 7, network extraction] the inline FK to builder_organisations was
  -- released live by 20261122000000 and the table is dropped by 20261124000000;
  -- the column stays as recorded history.
  builder_organisation_id uuid,
  solicitor_firm_id uuid REFERENCES public.solicitor_firms(id),
  finance_agent_contact_id uuid REFERENCES public.finance_agent_contacts(id),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partner_org_reliance_class_requires_evidence CHECK (
    reporting_entity_classification NOT IN
      ('eligible_relying_reporting_entity', 'eligible_foreign_equivalent')
    OR (classification_evidence_reference IS NOT NULL
        AND verified_by IS NOT NULL AND verified_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_aml_partner_org_abn_active
  ON aml.partner_organisations (tenant_id, abn)
  WHERE abn IS NOT NULL AND status = 'active';

CREATE TABLE IF NOT EXISTS aml.partner_portal_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_org_id uuid NOT NULL REFERENCES aml.partner_organisations(id),
  portal_type text NOT NULL CHECK (portal_type IN
    ('finance', 'builder', 'developer', 'solicitor_conveyancer')),
  portal_user_source text NOT NULL CHECK (portal_user_source IN
    ('finance_portal_users', 'builder_portal_users', 'solicitor_portal_users')),
  portal_user_id uuid NOT NULL,
  organisation_role text NOT NULL DEFAULT 'member',
  compliance_role text CHECK (compliance_role IS NULL OR compliance_role IN
    ('compliance_officer', 'operations', 'read_only')),
  status text NOT NULL DEFAULT 'invited'
    CHECK (status IN ('invited', 'active', 'suspended', 'ended')),
  invited_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  suspended_at timestamptz,
  ended_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (portal_user_source, portal_user_id, partner_org_id)
);

CREATE TABLE IF NOT EXISTS aml.partner_case_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL DEFAULT 'default',
  case_id uuid NOT NULL REFERENCES aml.cases(id) ON DELETE CASCADE,
  client_id uuid,
  purchase_file_id uuid REFERENCES public.purchase_files(id),
  legal_matter_id uuid REFERENCES public.legal_matters(id),
  partner_org_id uuid NOT NULL REFERENCES aml.partner_organisations(id),
  portal_type text NOT NULL CHECK (portal_type IN
    ('finance', 'builder', 'developer', 'solicitor_conveyancer', 'other')),
  relationship_role text NOT NULL CHECK (btrim(relationship_role) <> ''),
  legal_route text NOT NULL CHECK (legal_route IN
    ('reliance', 'outsourced_cdd', 'independent_cdd', 'information_share_only')),
  purpose text NOT NULL CHECK (char_length(btrim(purpose)) >= 10),
  state text NOT NULL DEFAULT 'active'
    CHECK (state IN ('active', 'suspended', 'ended')),
  linked_by uuid NOT NULL,
  linked_at timestamptz NOT NULL DEFAULT now(),
  suspended_at timestamptz,
  suspended_by uuid,
  ended_at timestamptz,
  ended_by uuid,
  end_reason_code text CHECK (end_reason_code IS NULL OR end_reason_code IN
    ('completed', 'withdrawn', 'superseded', 'client_declined', 'other')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_aml_partner_case_link_active
  ON aml.partner_case_links (case_id, partner_org_id, relationship_role)
  WHERE state = 'active';
CREATE INDEX IF NOT EXISTS idx_aml_partner_case_links_case
  ON aml.partner_case_links (case_id, state);
CREATE INDEX IF NOT EXISTS idx_aml_partner_case_links_org
  ON aml.partner_case_links (partner_org_id, state, linked_at DESC);

CREATE TABLE IF NOT EXISTS aml.partner_org_name_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id uuid NOT NULL UNIQUE REFERENCES aml.reliance_agreements(id),
  original_name text NOT NULL,
  original_org_type text NOT NULL,
  original_abn text,
  proposed_partner_org_id uuid REFERENCES aml.partner_organisations(id),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'mapped', 'rejected')),
  mapped_by uuid,
  mapped_at timestamptz,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partner_mapping_requires_reviewer CHECK (
    status <> 'mapped'
    OR (proposed_partner_org_id IS NOT NULL
        AND mapped_by IS NOT NULL AND mapped_at IS NOT NULL)
  )
);

ALTER TABLE aml.reliance_agreements
  ADD COLUMN IF NOT EXISTS partner_org_id uuid REFERENCES aml.partner_organisations(id);
ALTER TABLE aml.reliance_grants
  ADD COLUMN IF NOT EXISTS partner_org_id uuid REFERENCES aml.partner_organisations(id);
ALTER TABLE aml.reliance_grants
  ADD COLUMN IF NOT EXISTS partner_case_link_id uuid REFERENCES aml.partner_case_links(id);

CREATE INDEX IF NOT EXISTS idx_aml_reliance_agreements_partner_org
  ON aml.reliance_agreements (partner_org_id) WHERE partner_org_id IS NOT NULL;

INSERT INTO aml.partner_org_name_mappings
  (agreement_id, original_name, original_org_type, original_abn)
SELECT ra.id, ra.partner_org_name, ra.partner_org_type, ra.partner_abn
FROM aml.reliance_agreements ra
ON CONFLICT (agreement_id) DO NOTHING;

DROP TRIGGER IF EXISTS trg_aml_partner_orgs_updated_at ON aml.partner_organisations;
CREATE TRIGGER trg_aml_partner_orgs_updated_at
  BEFORE UPDATE ON aml.partner_organisations
  FOR EACH ROW EXECUTE FUNCTION aml.touch_updated_at();
DROP TRIGGER IF EXISTS trg_aml_partner_memberships_updated_at ON aml.partner_portal_memberships;
CREATE TRIGGER trg_aml_partner_memberships_updated_at
  BEFORE UPDATE ON aml.partner_portal_memberships
  FOR EACH ROW EXECUTE FUNCTION aml.touch_updated_at();
DROP TRIGGER IF EXISTS trg_aml_partner_case_links_updated_at ON aml.partner_case_links;
CREATE TRIGGER trg_aml_partner_case_links_updated_at
  BEFORE UPDATE ON aml.partner_case_links
  FOR EACH ROW EXECUTE FUNCTION aml.touch_updated_at();

GRANT ALL ON aml.partner_organisations, aml.partner_portal_memberships,
  aml.partner_case_links, aml.partner_org_name_mappings TO service_role;
ALTER TABLE aml.partner_organisations ENABLE ROW LEVEL SECURITY;
ALTER TABLE aml.partner_portal_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE aml.partner_case_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE aml.partner_org_name_mappings ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['partner_organisations','partner_portal_memberships',
      'partner_case_links','partner_org_name_mappings'] LOOP
    BEGIN
      EXECUTE format(
        'CREATE POLICY "aml_%s_service_only" ON aml.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
        t, t);
    EXCEPTION WHEN duplicate_object THEN NULL; END;
  END LOOP;
END $$;

INSERT INTO public.feature_flags (key, value, description)
VALUES
  ('aml_partner_identity', 'false'::jsonb,
   'AML partner domain Phase 1: new reliance grants require a canonical partner organisation and an active partner-case link with legal_route=reliance. Off = legacy free-text agreement behaviour.')
ON CONFLICT (key) DO NOTHING;