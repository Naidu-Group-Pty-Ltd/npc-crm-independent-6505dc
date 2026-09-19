-- ─── Partner referral register (Phase 2) ──────────────────────────────

CREATE TABLE public.partner_referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text NOT NULL UNIQUE,
  direction text NOT NULL CHECK (direction IN ('inbound_property_referral','outbound_finance_referral')),
  agreement_id uuid REFERENCES public.partner_agreements(id) ON DELETE SET NULL,
  agreement_version integer,

  -- Referring side
  finance_agent_contact_id uuid,
  referring_entity_name text,
  referring_individual_name text,
  referring_individual_crn text,
  referring_contact_email text,
  referring_contact_phone text,

  -- Client (information boundary: name + contact + general purpose only)
  client_first_name text NOT NULL,
  client_surname text,
  client_email text,
  client_phone text,
  general_purpose text,
  preferred_contact_method text,
  preferred_contact_time text,

  -- Compliance gates
  consent_obtained boolean NOT NULL DEFAULT false,
  consent_obtained_at timestamptz,
  consent_method text,
  consent_artefact_path text,
  benefit_disclosed boolean NOT NULL DEFAULT false,
  benefit_disclosed_at timestamptz,
  prior_client_check text NOT NULL DEFAULT 'unchecked'
    CHECK (prior_client_check IN ('unchecked','new','existing','duplicate')),

  -- Assignment
  assigned_consultant_id uuid,
  assigned_consultant_name text,
  assigned_finance_user_id uuid,
  assigned_loan_writer_name text,

  -- Lifecycle
  status text NOT NULL DEFAULT 'draft',
  status_reason text,
  submitted_at timestamptz,
  accepted_at timestamptz,
  declined_at timestamptz,
  completed_at timestamptz,

  -- Commercial
  commercial_eligibility text NOT NULL DEFAULT 'pending'
    CHECK (commercial_eligibility IN ('pending','eligible','not_eligible')),
  eligibility_reason text,
  estimated_value numeric,

  -- Conversion links
  client_id uuid,
  purchase_file_id uuid,
  client_deal_id uuid,

  internal_notes text,
  shared_notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.partner_referrals TO service_role;
ALTER TABLE public.partner_referrals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "partner_referrals_service_role_only"
  ON public.partner_referrals FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE INDEX idx_partner_referrals_direction_status ON public.partner_referrals(direction, status);
CREATE INDEX idx_partner_referrals_agreement ON public.partner_referrals(agreement_id);
CREATE INDEX idx_partner_referrals_finance_contact ON public.partner_referrals(finance_agent_contact_id);
CREATE INDEX idx_partner_referrals_client ON public.partner_referrals(client_id);
CREATE INDEX idx_partner_referrals_assigned_finance_user ON public.partner_referrals(assigned_finance_user_id);

CREATE TRIGGER trg_partner_referrals_updated_at
  BEFORE UPDATE ON public.partner_referrals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


CREATE TABLE public.partner_referral_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_id uuid NOT NULL REFERENCES public.partner_referrals(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  actor_id uuid,
  actor_label text,
  actor_surface text,
  summary text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.partner_referral_events TO service_role;
ALTER TABLE public.partner_referral_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "partner_referral_events_service_role_only"
  ON public.partner_referral_events FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE INDEX idx_partner_referral_events_referral ON public.partner_referral_events(referral_id, created_at DESC);

ALTER PUBLICATION supabase_realtime ADD TABLE public.partner_referrals;