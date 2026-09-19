
-- ============================================================================
-- BATCH 7 — Documents & Compliance Power (#38-43)
--   #38 Doc OCR + Anti-Tamper Check       → purchase_file_doc_compliance_checks
--   #39 Verification of Identity (VOI)    → purchase_file_voi_verifications
--   #40 Bank Statement Connector (Illion) → purchase_file_bank_statement_requests
--   #41 CreditCheck (Equifax/Experian)    → purchase_file_credit_checks
--   #42 eSignature on Discovery Docs      → purchase_file_discovery_signatures
--   #43 NCCP Compliance Vault             → purchase_file_nccp_bundles
-- ============================================================================

-- #38 Doc compliance checks (OCR + anti-tamper) ------------------------------
CREATE TABLE public.purchase_file_doc_compliance_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_file_id UUID NOT NULL,
  document_id UUID NULL,
  requirement_instance_id UUID NULL,
  applicant_id UUID NULL,
  check_type TEXT NOT NULL DEFAULT 'ocr_anti_tamper',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','passed','warning','failed','error')),
  ocr_text TEXT NULL,
  ai_summary TEXT NULL,
  findings JSONB NOT NULL DEFAULT '[]'::jsonb,
  detected_doc_type TEXT NULL,
  detected_name TEXT NULL,
  detected_date DATE NULL,
  expires_at DATE NULL,
  tamper_score NUMERIC NULL,
  ran_by UUID NULL,
  ran_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.purchase_file_doc_compliance_checks TO service_role;
ALTER TABLE public.purchase_file_doc_compliance_checks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role manages doc compliance checks"
  ON public.purchase_file_doc_compliance_checks FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE INDEX idx_doc_compliance_pf ON public.purchase_file_doc_compliance_checks(purchase_file_id, ran_at DESC);
CREATE INDEX idx_doc_compliance_inst ON public.purchase_file_doc_compliance_checks(requirement_instance_id) WHERE requirement_instance_id IS NOT NULL;

-- #39 VOI verifications ------------------------------------------------------
CREATE TABLE public.purchase_file_voi_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_file_id UUID NOT NULL,
  applicant_id UUID NULL,
  client_id UUID NULL,
  provider TEXT NOT NULL DEFAULT 'stub' CHECK (provider IN ('stub','frankie','idverse','manual')),
  provider_ref TEXT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','in_progress','passed','failed','expired','cancelled')),
  verification_url TEXT NULL,
  selfie_match BOOLEAN NULL,
  id_documents JSONB NOT NULL DEFAULT '[]'::jsonb,
  result JSONB NOT NULL DEFAULT '{}'::jsonb,
  initiated_by UUID NULL,
  completed_at TIMESTAMPTZ NULL,
  expires_at TIMESTAMPTZ NULL,
  notes TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.purchase_file_voi_verifications TO service_role;
ALTER TABLE public.purchase_file_voi_verifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role manages voi" ON public.purchase_file_voi_verifications
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE INDEX idx_voi_pf ON public.purchase_file_voi_verifications(purchase_file_id, created_at DESC);

-- #40 Bank statement requests ------------------------------------------------
CREATE TABLE public.purchase_file_bank_statement_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_file_id UUID NOT NULL,
  applicant_id UUID NULL,
  client_id UUID NULL,
  provider TEXT NOT NULL DEFAULT 'illion' CHECK (provider IN ('illion','bankstatements','manual','stub')),
  provider_ref TEXT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','connected','received','error','cancelled')),
  consent_url TEXT NULL,
  period_days INTEGER NOT NULL DEFAULT 90,
  account_count INTEGER NULL,
  statements_received_at TIMESTAMPTZ NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  initiated_by UUID NULL,
  notes TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.purchase_file_bank_statement_requests TO service_role;
ALTER TABLE public.purchase_file_bank_statement_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role manages bank stmt reqs" ON public.purchase_file_bank_statement_requests
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE INDEX idx_bsr_pf ON public.purchase_file_bank_statement_requests(purchase_file_id, created_at DESC);

-- #41 Credit checks ----------------------------------------------------------
CREATE TABLE public.purchase_file_credit_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_file_id UUID NOT NULL,
  applicant_id UUID NULL,
  client_id UUID NULL,
  provider TEXT NOT NULL DEFAULT 'stub' CHECK (provider IN ('equifax','experian','illion','stub','manual')),
  provider_ref TEXT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','consent_sent','in_progress','complete','failed','cancelled')),
  consent_given_at TIMESTAMPTZ NULL,
  consent_ip INET NULL,
  consent_proof JSONB NOT NULL DEFAULT '{}'::jsonb,
  score INTEGER NULL,
  band TEXT NULL,
  report_url TEXT NULL,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  ran_at TIMESTAMPTZ NULL,
  initiated_by UUID NULL,
  notes TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.purchase_file_credit_checks TO service_role;
ALTER TABLE public.purchase_file_credit_checks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role manages credit checks" ON public.purchase_file_credit_checks
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE INDEX idx_credit_pf ON public.purchase_file_credit_checks(purchase_file_id, created_at DESC);

-- #42 Discovery doc signatures ----------------------------------------------
CREATE TABLE public.purchase_file_discovery_signatures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_file_id UUID NOT NULL,
  applicant_id UUID NULL,
  client_id UUID NULL,
  doc_type TEXT NOT NULL CHECK (doc_type IN ('privacy_consent','credit_guide','fact_find_ack','best_interest_duty','fee_disclosure','credit_proposal','custom')),
  doc_label TEXT NULL,
  provider TEXT NOT NULL DEFAULT 'docusign' CHECK (provider IN ('docusign','manual','stub')),
  envelope_id TEXT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','viewed','signed','declined','voided','expired')),
  recipient_email TEXT NULL,
  recipient_name TEXT NULL,
  sent_at TIMESTAMPTZ NULL,
  signed_at TIMESTAMPTZ NULL,
  document_url TEXT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  initiated_by UUID NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.purchase_file_discovery_signatures TO service_role;
ALTER TABLE public.purchase_file_discovery_signatures ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role manages discovery sigs" ON public.purchase_file_discovery_signatures
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE INDEX idx_disc_sig_pf ON public.purchase_file_discovery_signatures(purchase_file_id, created_at DESC);

-- #43 NCCP compliance bundles -----------------------------------------------
CREATE TABLE public.purchase_file_nccp_bundles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_file_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ready','archived','stale')),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  generated_by UUID NULL,
  manifest JSONB NOT NULL DEFAULT '[]'::jsonb,
  missing_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  completeness_pct NUMERIC NULL,
  bundle_url TEXT NULL,
  notes TEXT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.purchase_file_nccp_bundles TO service_role;
ALTER TABLE public.purchase_file_nccp_bundles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role manages nccp bundles" ON public.purchase_file_nccp_bundles
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE INDEX idx_nccp_pf ON public.purchase_file_nccp_bundles(purchase_file_id, generated_at DESC);

-- updated_at triggers --------------------------------------------------------
CREATE TRIGGER trg_doc_compliance_updated BEFORE UPDATE ON public.purchase_file_doc_compliance_checks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_voi_updated BEFORE UPDATE ON public.purchase_file_voi_verifications
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_bsr_updated BEFORE UPDATE ON public.purchase_file_bank_statement_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_credit_updated BEFORE UPDATE ON public.purchase_file_credit_checks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_disc_sig_updated BEFORE UPDATE ON public.purchase_file_discovery_signatures
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_nccp_updated BEFORE UPDATE ON public.purchase_file_nccp_bundles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
