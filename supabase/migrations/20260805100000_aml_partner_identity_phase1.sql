-- Canonical partner identity — Phase 1 of the AML/CTF multi-portal
-- partner/reliance domain.
--
-- Until now the only record of a partner organisation was the free-text
-- partner_org_name on aml.reliance_agreements. A display string is not a
-- security principal: it cannot be classified, deduplicated, suspended, or
-- bound to a portal login. This migration introduces the canonical identity
-- without changing any existing behaviour:
--
--   partner_organisations      the canonical legal identity of a partner.
--                              Classification values are CONFIGURATION, not
--                              legal conclusions: every row starts
--                              'unclassified', and a reliance-capable
--                              classification is structurally unusable until
--                              authorised evidence is recorded (CHECK below).
--   partner_portal_memberships maps an authenticated portal user (builder /
--                              solicitor / finance portal tables remain the
--                              authentication authority) to ONE canonical
--                              partner organisation and role. No credentials
--                              are duplicated here.
--   partner_case_links         the access root: why THIS organisation may
--                              see THIS case/deal. A partner never gains
--                              access merely by having an account, matching
--                              an agreement name, or knowing a case id.
--   partner_org_name_mappings  reviewed backfill of existing free-text
--                              agreement names. Exact copies only — no fuzzy
--                              matching, no auto-merge, no guessed ABNs.
--                              Every mapping requires a human reviewer.
--
-- Existing reliance tables gain NULLABLE canonical references only.
-- partner_org_name is preserved; historical rows are untouched; current
-- readers keep working. Enforcement of the new path is behind the
-- aml_partner_identity feature flag (seeded false) in the aml-reliance
-- edge function — this migration changes no runtime behaviour by itself.
--
-- Additive only.
--
-- ROLLBACK:
--   ALTER TABLE aml.reliance_grants DROP COLUMN IF EXISTS partner_case_link_id;
--   ALTER TABLE aml.reliance_grants DROP COLUMN IF EXISTS partner_org_id;
--   ALTER TABLE aml.reliance_agreements DROP COLUMN IF EXISTS partner_org_id;
--   DROP TABLE IF EXISTS aml.partner_org_name_mappings;
--   DROP TABLE IF EXISTS aml.partner_case_links;
--   DROP TABLE IF EXISTS aml.partner_portal_memberships;
--   DROP TABLE IF EXISTS aml.partner_organisations;
--   DELETE FROM public.feature_flags WHERE key = 'aml_partner_identity';

CREATE TABLE IF NOT EXISTS aml.partner_organisations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Single-tenant today ('default', matching aml.tenant_settings); the
  -- column exists so partner identity is never retrofitted for tenancy.
  tenant_id text NOT NULL DEFAULT 'default',
  legal_name text NOT NULL CHECK (btrim(legal_name) <> ''),
  trading_name text,
  abn text,
  registration_reference text,
  registration_country text NOT NULL DEFAULT 'AU',
  organisation_type text NOT NULL CHECK (organisation_type IN
    ('finance', 'builder', 'developer', 'solicitor_conveyancer', 'other')),
  -- Which portals this organisation's users may be mapped through.
  portal_types text[] NOT NULL DEFAULT ARRAY[]::text[],
  -- Reporting-entity classification is a LEGAL determination. The system
  -- stores which controlled value an authorised human recorded and the
  -- evidence reference — it never infers one. 'unclassified' is the safe
  -- default and blocks nothing except reliance-capable behaviour.
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
  -- Explicit references to the source portal organisation models, which
  -- remain the authentication authority for their portals. Nullable: a
  -- partner may pre-date its portal onboarding. Finance has no organisation
  -- table (its "organisation" is free text on a contact), hence the
  -- contact-level reference.
  -- [Phase 7, network extraction] the inline FK to builder_organisations was
  -- released live by 20261122000000 and the table is dropped by 20261124000000;
  -- the column stays as recorded history.
  builder_organisation_id uuid,
  solicitor_firm_id uuid REFERENCES public.solicitor_firms(id),
  finance_agent_contact_id uuid REFERENCES public.finance_agent_contacts(id),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- A reliance-capable classification without recorded evidence and an
  -- authorised verifier is structurally impossible, not merely discouraged.
  CONSTRAINT partner_org_reliance_class_requires_evidence CHECK (
    reporting_entity_classification NOT IN
      ('eligible_relying_reporting_entity', 'eligible_foreign_equivalent')
    OR (classification_evidence_reference IS NOT NULL
        AND verified_by IS NOT NULL AND verified_at IS NOT NULL)
  )
);

-- Exact-ABN duplicate prevention for live rows. Deliberately NOT a fuzzy or
-- name-based rule: two rows may share a name (the mapping review resolves
-- that); they may not share an ABN while both active in one tenant.
CREATE UNIQUE INDEX IF NOT EXISTS uq_aml_partner_org_abn_active
  ON aml.partner_organisations (tenant_id, abn)
  WHERE abn IS NOT NULL AND status = 'active';

CREATE TABLE IF NOT EXISTS aml.partner_portal_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_org_id uuid NOT NULL REFERENCES aml.partner_organisations(id),
  portal_type text NOT NULL CHECK (portal_type IN
    ('finance', 'builder', 'developer', 'solicitor_conveyancer')),
  -- Identity reference into the portal's own user table. Authentication
  -- stays with the portal; this row only maps a trusted portal identity to
  -- a canonical partner organisation. No credential is stored here.
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
  -- One membership row per portal identity per organisation. A user may
  -- belong to several organisations (builder portal supports this); a
  -- membership can never widen into a second organisation.
  UNIQUE (portal_user_source, portal_user_id, partner_org_id)
);

CREATE TABLE IF NOT EXISTS aml.partner_case_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL DEFAULT 'default',
  -- CASCADE matches the sibling reliance tables. Retention classification
  -- for partner records (incl. survival of link history beyond case
  -- disposal) is Phase 7 scope and is recorded in the gap register.
  case_id uuid NOT NULL REFERENCES aml.cases(id) ON DELETE CASCADE,
  client_id uuid,
  purchase_file_id uuid REFERENCES public.purchase_files(id),
  legal_matter_id uuid REFERENCES public.legal_matters(id),
  partner_org_id uuid NOT NULL REFERENCES aml.partner_organisations(id),
  portal_type text NOT NULL CHECK (portal_type IN
    ('finance', 'builder', 'developer', 'solicitor_conveyancer', 'other')),
  relationship_role text NOT NULL CHECK (btrim(relationship_role) <> ''),
  -- The four legal routes are DISTINCT. reliance is never inferred from
  -- portal type, organisation type, or the existence of an agreement.
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
  -- Partner-safe end reason: a controlled code, never internal commentary.
  end_reason_code text CHECK (end_reason_code IS NULL OR end_reason_code IN
    ('completed', 'withdrawn', 'superseded', 'client_declined', 'other')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One ACTIVE link per case × organisation × role. Multiple roles for the
-- same partner on one case remain legitimate; re-linking after an ended
-- link remains legitimate.
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
  -- Exact copies of what the agreement recorded — preserved verbatim so the
  -- original free-text value survives the mapping.
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
  -- A mapping cannot be marked mapped without a target and a reviewer.
  CONSTRAINT partner_mapping_requires_reviewer CHECK (
    status <> 'mapped'
    OR (proposed_partner_org_id IS NOT NULL
        AND mapped_by IS NOT NULL AND mapped_at IS NOT NULL)
  )
);

-- Nullable canonical references on the existing reliance tables. Free-text
-- partner_org_name is preserved; nothing is converted destructively.
ALTER TABLE aml.reliance_agreements
  ADD COLUMN IF NOT EXISTS partner_org_id uuid REFERENCES aml.partner_organisations(id);
ALTER TABLE aml.reliance_grants
  ADD COLUMN IF NOT EXISTS partner_org_id uuid REFERENCES aml.partner_organisations(id);
ALTER TABLE aml.reliance_grants
  ADD COLUMN IF NOT EXISTS partner_case_link_id uuid REFERENCES aml.partner_case_links(id);

CREATE INDEX IF NOT EXISTS idx_aml_reliance_agreements_partner_org
  ON aml.reliance_agreements (partner_org_id) WHERE partner_org_id IS NOT NULL;

-- Seed the review queue: one PENDING candidate per existing agreement,
-- copied byte-for-byte. proposed_partner_org_id stays NULL — a human
-- reviewer resolves every mapping; SQL never guesses an organisation.
INSERT INTO aml.partner_org_name_mappings
  (agreement_id, original_name, original_org_type, original_abn)
SELECT ra.id, ra.partner_org_name, ra.partner_org_type, ra.partner_abn
FROM aml.reliance_agreements ra
ON CONFLICT (agreement_id) DO NOTHING;

-- updated_at maintenance, same helper the finance-requests table uses.
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

-- Deny-by-default: service-role only, same posture as the reliance tables.
-- No grant to authenticated — all access is through SECURITY DEFINER edge
-- functions that perform their own authorisation.
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

-- Feature flag: enforcement of canonical-partner requirements on new
-- reliance access. Off by default — behaviour is unchanged until an
-- operator enables it per environment.
INSERT INTO public.feature_flags (key, value, description)
VALUES
  ('aml_partner_identity', 'false'::jsonb,
   'AML partner domain Phase 1: new reliance grants require a canonical partner organisation and an active partner-case link with legal_route=reliance. Off = legacy free-text agreement behaviour.')
ON CONFLICT (key) DO NOTHING;
