-- ─── Enums ─────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE public.partner_agreement_direction AS ENUM ('inbound_property_referral', 'outbound_finance_referral');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.partner_agreement_status AS ENUM ('draft', 'pending_review', 'sent_for_signature', 'partially_signed', 'active', 'terminated', 'superseded', 'void');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.partner_fee_model AS ENUM ('fixed_fee', 'percentage_of_fee', 'tiered', 'other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.partner_gst_treatment AS ENUM ('plus_gst', 'inclusive_of_gst', 'not_applicable');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.partner_invoice_process AS ENUM ('tax_invoice', 'rcti');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.partner_commission_basis AS ENUM ('gross', 'net_of_aggregator');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── partner_agreements ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.partner_agreements (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  direction public.partner_agreement_direction NOT NULL,
  status public.partner_agreement_status NOT NULL DEFAULT 'draft',
  version INTEGER NOT NULL DEFAULT 1,
  document_version TEXT NOT NULL DEFAULT '2.0',
  supersedes_agreement_id UUID REFERENCES public.partner_agreements(id) ON DELETE SET NULL,

  -- Partner (counterparty)
  finance_agent_contact_id UUID,
  partner_legal_name TEXT NOT NULL,
  partner_trading_name TEXT,
  partner_abn TEXT,
  partner_acn TEXT,
  partner_acl_number TEXT,
  partner_credit_rep_number TEXT,
  partner_aggregator TEXT,
  partner_address TEXT,
  partner_contact_name TEXT,
  partner_contact_email TEXT,
  partner_contact_phone TEXT,
  partner_notice_email TEXT,

  -- Principal (NPC / buyer's agency)
  principal_legal_name TEXT NOT NULL DEFAULT 'NPC Services Pty Ltd',
  principal_trading_name TEXT,
  principal_abn TEXT,
  principal_acn TEXT,
  principal_licence_number TEXT,
  principal_address TEXT,
  principal_contact_name TEXT,
  principal_contact_email TEXT,
  principal_notice_email TEXT,

  -- Terms
  governing_state TEXT NOT NULL DEFAULT 'NSW',
  effective_date DATE,
  termination_date DATE,
  termination_notice_days INTEGER NOT NULL DEFAULT 30,
  dispute_window_days INTEGER NOT NULL DEFAULT 30,
  records_retention_years INTEGER NOT NULL DEFAULT 7,
  executed_under_s127 BOOLEAN NOT NULL DEFAULT false,

  -- Commercial schedule (shared)
  fee_model public.partner_fee_model,
  fee_amount NUMERIC(14,2),
  fee_percentage NUMERIC(7,4),
  gst_treatment public.partner_gst_treatment,
  qualifying_event TEXT,
  payment_business_days INTEGER,
  invoice_process public.partner_invoice_process,
  exclusions TEXT,
  duplicate_referral_rule TEXT,
  fee_cap NUMERIC(14,2),
  fee_minimum NUMERIC(14,2),
  post_termination_entitlement TEXT,

  -- Commercial schedule (outbound finance commission specifics)
  upfront_share_pct NUMERIC(7,4),
  trail_share_pct NUMERIC(7,4),
  commission_basis public.partner_commission_basis,
  payment_cycle TEXT,
  cleared_funds_required BOOLEAN NOT NULL DEFAULT true,
  clawback_treatment TEXT,
  clawback_repayment_days INTEGER,
  includes_refinance_topup BOOLEAN NOT NULL DEFAULT false,

  -- Free-form / template extras
  schedule_extras JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Documents & signing
  template_id UUID,
  pdf_storage_path TEXT,
  signed_pdf_storage_path TEXT,
  docusign_envelope_id TEXT,
  docusign_status TEXT,
  docusign_sent_at TIMESTAMPTZ,
  docusign_signed_at TIMESTAMPTZ,
  sent_via TEXT NOT NULL DEFAULT 'docusign',

  activated_at TIMESTAMPTZ,
  terminated_at TIMESTAMPTZ,
  termination_reason TEXT,
  notes TEXT,

  created_by UUID,
  updated_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT ALL ON public.partner_agreements TO service_role;
ALTER TABLE public.partner_agreements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "partner_agreements_service_role_only"
  ON public.partner_agreements FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_partner_agreements_direction_status ON public.partner_agreements(direction, status);
CREATE INDEX IF NOT EXISTS idx_partner_agreements_contact ON public.partner_agreements(finance_agent_contact_id);
CREATE INDEX IF NOT EXISTS idx_partner_agreements_envelope ON public.partner_agreements(docusign_envelope_id);

-- ─── partner_agreement_events ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.partner_agreement_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  agreement_id UUID NOT NULL REFERENCES public.partner_agreements(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  actor_id UUID,
  actor_label TEXT,
  summary TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT ALL ON public.partner_agreement_events TO service_role;
ALTER TABLE public.partner_agreement_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "partner_agreement_events_service_role_only"
  ON public.partner_agreement_events FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_partner_agreement_events_agreement ON public.partner_agreement_events(agreement_id, created_at DESC);

-- ─── updated_at trigger ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.partner_agreements_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_partner_agreements_touch ON public.partner_agreements;
CREATE TRIGGER trg_partner_agreements_touch
  BEFORE UPDATE ON public.partner_agreements
  FOR EACH ROW EXECUTE FUNCTION public.partner_agreements_touch_updated_at();
