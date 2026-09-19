-- ============================================================
-- BATCH 7E.1: Commission, Compliance, Documents, Analytics
-- ============================================================

-- ============ ENUMS ============
DO $$ BEGIN
  CREATE TYPE public.commission_type AS ENUM ('upfront', 'trail', 'bonus', 'clawback');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.commission_status AS ENUM ('forecast', 'invoiced', 'received', 'reconciled', 'clawed_back');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.payout_status AS ENUM ('draft', 'pending', 'paid', 'cancelled');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.compliance_record_type AS ENUM (
    'bid','fact_find','preliminary_assessment','credit_guide','privacy_consent','fha','best_interests_duty','cost_disclosure'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.compliance_status AS ENUM ('draft','pending_signature','signed','expired','superseded','voided');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.signature_method AS ENUM ('docusign','wet','portal_consent','email_consent');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.template_doc_type AS ENUM (
    'loan_application','supporting_docs_cover','bid','credit_guide','cost_disclosure','consent_form','fact_find','preliminary_assessment','generic'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.generated_doc_status AS ENUM ('draft','generated','sent','viewed','signed','voided','expired');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ============ COMMISSION LEDGER ============
CREATE TABLE public.commission_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID REFERENCES public.client_deals(id) ON DELETE SET NULL,
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  submission_id UUID REFERENCES public.lender_submissions(id) ON DELETE SET NULL,
  lender_id TEXT,
  lender_name TEXT,
  type public.commission_type NOT NULL DEFAULT 'upfront',
  loan_amount NUMERIC,
  commission_rate NUMERIC,
  gross_amount NUMERIC NOT NULL DEFAULT 0,
  broker_split_pct NUMERIC NOT NULL DEFAULT 100,
  broker_amount NUMERIC NOT NULL DEFAULT 0,
  aggregator_fee NUMERIC NOT NULL DEFAULT 0,
  gst_amount NUMERIC NOT NULL DEFAULT 0,
  net_amount NUMERIC NOT NULL DEFAULT 0,
  status public.commission_status NOT NULL DEFAULT 'forecast',
  expected_date DATE,
  invoiced_date DATE,
  received_date DATE,
  reconciled_date DATE,
  reference TEXT,
  broker_id UUID,
  notes TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_commission_ledger_deal ON public.commission_ledger(deal_id);
CREATE INDEX idx_commission_ledger_status ON public.commission_ledger(status);
CREATE INDEX idx_commission_ledger_broker ON public.commission_ledger(broker_id);
CREATE INDEX idx_commission_ledger_expected ON public.commission_ledger(expected_date);

ALTER TABLE public.commission_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role only" ON public.commission_ledger FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE TRIGGER trg_commission_ledger_updated_at
  BEFORE UPDATE ON public.commission_ledger
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ COMMISSION PAYOUTS ============
CREATE TABLE public.commission_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broker_id UUID NOT NULL,
  broker_name TEXT,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  total_gross NUMERIC NOT NULL DEFAULT 0,
  total_net NUMERIC NOT NULL DEFAULT 0,
  total_gst NUMERIC NOT NULL DEFAULT 0,
  ledger_entry_ids UUID[] DEFAULT '{}',
  entry_count INTEGER NOT NULL DEFAULT 0,
  status public.payout_status NOT NULL DEFAULT 'draft',
  payment_reference TEXT,
  payment_method TEXT,
  pdf_storage_path TEXT,
  paid_at TIMESTAMPTZ,
  notes TEXT,
  generated_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_commission_payouts_broker ON public.commission_payouts(broker_id);
CREATE INDEX idx_commission_payouts_period ON public.commission_payouts(period_start, period_end);

ALTER TABLE public.commission_payouts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role only" ON public.commission_payouts FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE TRIGGER trg_commission_payouts_updated_at
  BEFORE UPDATE ON public.commission_payouts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ COMPLIANCE RECORDS (versioned) ============
CREATE TABLE public.compliance_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  deal_id UUID REFERENCES public.client_deals(id) ON DELETE SET NULL,
  type public.compliance_record_type NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  is_current BOOLEAN NOT NULL DEFAULT true,
  status public.compliance_status NOT NULL DEFAULT 'draft',
  title TEXT NOT NULL,
  content JSONB NOT NULL DEFAULT '{}'::jsonb,
  pdf_storage_path TEXT,
  signed_pdf_storage_path TEXT,
  signature_method public.signature_method,
  docusign_envelope_id TEXT,
  docusign_status TEXT,
  generated_by UUID,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  signed_at TIMESTAMPTZ,
  signed_by_name TEXT,
  expires_at TIMESTAMPTZ,
  superseded_by UUID,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(client_id, type, version)
);
CREATE INDEX idx_compliance_records_client ON public.compliance_records(client_id);
CREATE INDEX idx_compliance_records_type ON public.compliance_records(type);
CREATE INDEX idx_compliance_records_current ON public.compliance_records(client_id, type) WHERE is_current = true;

ALTER TABLE public.compliance_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role only" ON public.compliance_records FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE TRIGGER trg_compliance_records_updated_at
  BEFORE UPDATE ON public.compliance_records
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Trigger: when inserting a new version, mark prior versions of the same (client, type) as not current + superseded
CREATE OR REPLACE FUNCTION public.handle_compliance_version_supersede()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.is_current = true THEN
    UPDATE public.compliance_records
      SET is_current = false,
          status = CASE WHEN status = 'signed' THEN 'superseded'::compliance_status ELSE status END,
          superseded_by = NEW.id
    WHERE client_id = NEW.client_id
      AND type = NEW.type
      AND id <> NEW.id
      AND is_current = true;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_compliance_supersede
  AFTER INSERT ON public.compliance_records
  FOR EACH ROW EXECUTE FUNCTION public.handle_compliance_version_supersede();

-- ============ COMPLIANCE PACK EXPORTS ============
CREATE TABLE public.compliance_pack_exports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  deal_id UUID REFERENCES public.client_deals(id) ON DELETE SET NULL,
  included_record_ids UUID[] NOT NULL DEFAULT '{}',
  included_types public.compliance_record_type[] NOT NULL DEFAULT '{}',
  pdf_storage_path TEXT,
  page_count INTEGER,
  generated_by UUID,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  shared_with_client BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_compliance_pack_client ON public.compliance_pack_exports(client_id);

ALTER TABLE public.compliance_pack_exports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role only" ON public.compliance_pack_exports FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- ============ GENERATED DOCUMENTS ============
CREATE TABLE public.generated_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  deal_id UUID REFERENCES public.client_deals(id) ON DELETE SET NULL,
  submission_id UUID REFERENCES public.lender_submissions(id) ON DELETE SET NULL,
  template_id UUID,
  template_type public.template_doc_type NOT NULL DEFAULT 'generic',
  title TEXT NOT NULL,
  status public.generated_doc_status NOT NULL DEFAULT 'draft',
  pdf_storage_path TEXT,
  signed_pdf_storage_path TEXT,
  docusign_envelope_id TEXT,
  docusign_status TEXT,
  sent_to TEXT[],
  sent_at TIMESTAMPTZ,
  viewed_at TIMESTAMPTZ,
  signed_at TIMESTAMPTZ,
  voided_at TIMESTAMPTZ,
  voided_reason TEXT,
  generation_payload JSONB DEFAULT '{}'::jsonb,
  audit JSONB DEFAULT '[]'::jsonb,
  shared_with_client BOOLEAN NOT NULL DEFAULT false,
  generated_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_generated_documents_client ON public.generated_documents(client_id);
CREATE INDEX idx_generated_documents_deal ON public.generated_documents(deal_id);
CREATE INDEX idx_generated_documents_status ON public.generated_documents(status);

ALTER TABLE public.generated_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role only" ON public.generated_documents FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE TRIGGER trg_generated_documents_updated_at
  BEFORE UPDATE ON public.generated_documents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ DOCUMENT SIGNATURE EVENTS ============
CREATE TABLE public.document_signature_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID REFERENCES public.generated_documents(id) ON DELETE CASCADE,
  compliance_record_id UUID REFERENCES public.compliance_records(id) ON DELETE CASCADE,
  docusign_envelope_id TEXT,
  event_type TEXT NOT NULL,
  event_status TEXT,
  recipient_email TEXT,
  recipient_name TEXT,
  payload JSONB DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_doc_sig_events_document ON public.document_signature_events(document_id);
CREATE INDEX idx_doc_sig_events_compliance ON public.document_signature_events(compliance_record_id);
CREATE INDEX idx_doc_sig_events_envelope ON public.document_signature_events(docusign_envelope_id);

ALTER TABLE public.document_signature_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role only" ON public.document_signature_events FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- Trigger: forecast commission when submission becomes 'submitted'
CREATE OR REPLACE FUNCTION public.handle_submission_commission_forecast()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_existing_count INTEGER;
  v_default_rate NUMERIC := 0.0065; -- 0.65% indicative
  v_gross NUMERIC;
BEGIN
  IF (TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'submitted')
     OR (TG_OP = 'INSERT' AND NEW.status = 'submitted') THEN

    SELECT COUNT(*) INTO v_existing_count
      FROM public.commission_ledger
      WHERE submission_id = NEW.id AND type = 'upfront';

    IF v_existing_count = 0 AND NEW.loan_amount IS NOT NULL THEN
      v_gross := COALESCE(NEW.loan_amount, 0) * v_default_rate;
      INSERT INTO public.commission_ledger (
        deal_id, client_id, submission_id, lender_id, lender_name,
        type, loan_amount, commission_rate,
        gross_amount, broker_split_pct, broker_amount,
        gst_amount, net_amount, status, expected_date, broker_id, notes
      ) VALUES (
        NEW.deal_id, NEW.client_id, NEW.id, NEW.lender_id, NEW.lender_name,
        'upfront', NEW.loan_amount, v_default_rate,
        v_gross, 100, v_gross,
        ROUND(v_gross * 0.10, 2), ROUND(v_gross * 0.90, 2),
        'forecast', (NEW.submitted_at::date + INTERVAL '45 days')::date,
        NEW.assigned_broker_id,
        'Auto-forecast on submission'
      );
    END IF;
  END IF;

  -- On settlement, mark forecasts as expected on settled date
  IF (TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'settled') THEN
    UPDATE public.commission_ledger
      SET expected_date = COALESCE(NEW.settled_at::date, CURRENT_DATE) + INTERVAL '14 days',
          notes = COALESCE(notes,'') || ' | Settled ' || COALESCE(NEW.settled_at::text,'')
      WHERE submission_id = NEW.id AND status = 'forecast';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_submission_commission_forecast ON public.lender_submissions;
CREATE TRIGGER trg_submission_commission_forecast
  AFTER INSERT OR UPDATE ON public.lender_submissions
  FOR EACH ROW EXECUTE FUNCTION public.handle_submission_commission_forecast();

-- ============ ANALYTICS VIEWS ============

-- Pipeline funnel: counts of submissions per status, last 12 months
CREATE OR REPLACE VIEW public.vw_pipeline_funnel AS
SELECT
  date_trunc('month', COALESCE(submitted_at, created_at))::date AS period,
  status,
  COUNT(*) AS submission_count,
  COALESCE(SUM(loan_amount), 0) AS total_loan_amount
FROM public.lender_submissions
WHERE COALESCE(submitted_at, created_at) >= (now() - INTERVAL '12 months')
GROUP BY 1, 2;

-- Lender mix: share + approval rate
CREATE OR REPLACE VIEW public.vw_lender_mix AS
SELECT
  lender_id,
  lender_name,
  COUNT(*) AS total_submissions,
  COUNT(*) FILTER (WHERE status IN ('conditional_approval','unconditional_approval','loan_docs_issued','settled')) AS approved_count,
  COUNT(*) FILTER (WHERE status = 'settled') AS settled_count,
  COUNT(*) FILTER (WHERE status = 'declined') AS declined_count,
  COALESCE(SUM(loan_amount),0) AS total_loan_volume,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE status IN ('conditional_approval','unconditional_approval','loan_docs_issued','settled'))
    / NULLIF(COUNT(*) FILTER (WHERE status NOT IN ('draft','pre_assessment','withdrawn')), 0)
  , 2) AS approval_rate_pct
FROM public.lender_submissions
WHERE created_at >= (now() - INTERVAL '12 months')
GROUP BY lender_id, lender_name;

-- Broker scorecard
CREATE OR REPLACE VIEW public.vw_broker_scorecard AS
SELECT
  s.assigned_broker_id AS broker_id,
  COUNT(*) AS total_submissions,
  COUNT(*) FILTER (WHERE s.status IN ('conditional_approval','unconditional_approval','loan_docs_issued','settled')) AS approvals,
  COUNT(*) FILTER (WHERE s.status = 'settled') AS settlements,
  ROUND(AVG(EXTRACT(EPOCH FROM (s.settled_at - s.submitted_at)) / 86400.0)::numeric, 1) AS avg_days_to_settle,
  COALESCE((
    SELECT SUM(net_amount) FROM public.commission_ledger c
    WHERE c.broker_id = s.assigned_broker_id
      AND c.status = 'received'
      AND c.received_date >= date_trunc('year', now())::date
  ),0) AS commission_ytd_net
FROM public.lender_submissions s
WHERE s.assigned_broker_id IS NOT NULL
GROUP BY s.assigned_broker_id;

-- Revenue dashboard: monthly forecast vs received
CREATE OR REPLACE VIEW public.vw_revenue_dashboard AS
SELECT
  date_trunc('month', COALESCE(received_date, expected_date, created_at::date))::date AS period,
  SUM(CASE WHEN status IN ('forecast','invoiced') THEN net_amount ELSE 0 END) AS forecast_net,
  SUM(CASE WHEN status IN ('received','reconciled') THEN net_amount ELSE 0 END) AS received_net,
  SUM(CASE WHEN status = 'clawed_back' THEN -net_amount ELSE 0 END) AS clawback_net,
  COUNT(*) AS entries
FROM public.commission_ledger
WHERE COALESCE(received_date, expected_date, created_at::date) >= (now() - INTERVAL '12 months')::date
GROUP BY 1
ORDER BY 1;

-- ============ REALTIME PUBLICATION ============
ALTER PUBLICATION supabase_realtime ADD TABLE public.commission_ledger;
ALTER PUBLICATION supabase_realtime ADD TABLE public.commission_payouts;
ALTER PUBLICATION supabase_realtime ADD TABLE public.compliance_records;
ALTER PUBLICATION supabase_realtime ADD TABLE public.generated_documents;
ALTER PUBLICATION supabase_realtime ADD TABLE public.document_signature_events;