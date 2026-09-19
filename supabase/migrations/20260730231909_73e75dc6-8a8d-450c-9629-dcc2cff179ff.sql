-- ─── Phase 3: consent capture + loan writer undertakings ─────────────

-- Annexure B — Loan writer / authorised representative undertaking
CREATE TABLE public.partner_loan_writer_undertakings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text NOT NULL UNIQUE,
  agreement_id uuid REFERENCES public.partner_agreements(id) ON DELETE SET NULL,
  finance_agent_contact_id uuid,
  finance_user_id uuid,

  writer_full_name text NOT NULL,
  writer_email text,
  writer_phone text,
  writer_entity_name text,
  licensee_name text,
  acl_number text,
  crn text,
  authorisation_end_date date,

  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','pending_signature','active','expired','terminated')),
  effective_date date,
  expiry_date date,

  signed_at timestamptz,
  signed_by_name text,
  signature_method text,
  signature_artefact_path text,
  envelope_id text,

  terminated_at timestamptz,
  termination_reason text,

  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.partner_loan_writer_undertakings TO service_role;
ALTER TABLE public.partner_loan_writer_undertakings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "partner_loan_writer_undertakings_service_role_only"
  ON public.partner_loan_writer_undertakings FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE INDEX idx_plwu_agreement ON public.partner_loan_writer_undertakings(agreement_id);
CREATE INDEX idx_plwu_status ON public.partner_loan_writer_undertakings(status);
CREATE INDEX idx_plwu_finance_user ON public.partner_loan_writer_undertakings(finance_user_id);
CREATE INDEX idx_plwu_finance_contact ON public.partner_loan_writer_undertakings(finance_agent_contact_id);

CREATE TRIGGER trg_plwu_updated_at
  BEFORE UPDATE ON public.partner_loan_writer_undertakings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- Annexure A — client referral consent capture
CREATE TABLE public.partner_consent_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_id uuid NOT NULL REFERENCES public.partner_referrals(id) ON DELETE CASCADE,

  token_hash text NOT NULL UNIQUE,
  channel text NOT NULL DEFAULT 'email' CHECK (channel IN ('email','sms','manual','in_person')),
  recipient_name text,
  recipient_email text,
  recipient_phone text,

  statement_version text NOT NULL DEFAULT 'v2.0',
  statement_text text NOT NULL,
  disclosure_text text,

  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','viewed','signed','declined','revoked','expired')),

  sent_at timestamptz NOT NULL DEFAULT now(),
  first_viewed_at timestamptz,
  signed_at timestamptz,
  declined_at timestamptz,
  revoked_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '14 days'),

  signature_name text,
  signature_typed text,
  signature_ip text,
  signature_user_agent text,
  artefact_path text,

  created_by uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.partner_consent_requests TO service_role;
ALTER TABLE public.partner_consent_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "partner_consent_requests_service_role_only"
  ON public.partner_consent_requests FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE INDEX idx_pcr_referral ON public.partner_consent_requests(referral_id, created_at DESC);
CREATE INDEX idx_pcr_status ON public.partner_consent_requests(status);

CREATE TRIGGER trg_pcr_updated_at
  BEFORE UPDATE ON public.partner_consent_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- Referral → undertaking + consent linkage
ALTER TABLE public.partner_referrals
  ADD COLUMN IF NOT EXISTS loan_writer_undertaking_id uuid
    REFERENCES public.partner_loan_writer_undertakings(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS consent_request_id uuid
    REFERENCES public.partner_consent_requests(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_partner_referrals_undertaking
  ON public.partner_referrals(loan_writer_undertaking_id);

ALTER PUBLICATION supabase_realtime ADD TABLE public.partner_consent_requests;
ALTER PUBLICATION supabase_realtime ADD TABLE public.partner_loan_writer_undertakings;