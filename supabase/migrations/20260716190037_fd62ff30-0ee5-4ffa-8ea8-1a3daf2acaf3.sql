
CREATE TABLE IF NOT EXISTS aml.transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES aml.cases(id) ON DELETE CASCADE,
  purchase_file_id uuid NULL,
  kind text NOT NULL DEFAULT 'purchase',
  status text NOT NULL DEFAULT 'draft',
  reference text NULL,
  property_address text NULL,
  contract_date date NULL,
  settlement_date date NULL,
  original_settlement_date date NULL,
  purchase_price numeric(14,2) NULL,
  deposit_amount numeric(14,2) NULL,
  currency text NOT NULL DEFAULT 'AUD',
  source text NOT NULL DEFAULT 'manual_entry',
  notes text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON aml.transactions TO authenticated;
GRANT ALL ON aml.transactions TO service_role;
ALTER TABLE aml.transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "aml_tx_read" ON aml.transactions FOR SELECT TO authenticated USING (public.has_any_aml_role(auth.uid()));
CREATE POLICY "aml_tx_write" ON aml.transactions FOR ALL TO authenticated USING (public.has_aml_write_role(auth.uid())) WITH CHECK (public.has_aml_write_role(auth.uid()));
CREATE INDEX IF NOT EXISTS idx_aml_tx_case ON aml.transactions(case_id);
CREATE INDEX IF NOT EXISTS idx_aml_tx_pf ON aml.transactions(purchase_file_id);

CREATE TABLE IF NOT EXISTS aml.transaction_parties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES aml.transactions(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES aml.cases(id) ON DELETE CASCADE,
  party_type text NOT NULL,
  capacity text NULL,
  display_name text NOT NULL,
  entity_id uuid NULL,
  external_reference text NULL,
  contact jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON aml.transaction_parties TO authenticated;
GRANT ALL ON aml.transaction_parties TO service_role;
ALTER TABLE aml.transaction_parties ENABLE ROW LEVEL SECURITY;
CREATE POLICY "aml_txp_read" ON aml.transaction_parties FOR SELECT TO authenticated USING (public.has_any_aml_role(auth.uid()));
CREATE POLICY "aml_txp_write" ON aml.transaction_parties FOR ALL TO authenticated USING (public.has_aml_write_role(auth.uid())) WITH CHECK (public.has_aml_write_role(auth.uid()));
CREATE INDEX IF NOT EXISTS idx_aml_txp_tx ON aml.transaction_parties(transaction_id);

CREATE TABLE IF NOT EXISTS aml.transaction_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES aml.transactions(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES aml.cases(id) ON DELETE CASCADE,
  category text NOT NULL,
  summary text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id uuid NULL,
  actor_label text NULL,
  prev_hash text NULL,
  row_hash text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON aml.transaction_events TO authenticated;
GRANT ALL ON aml.transaction_events TO service_role;
ALTER TABLE aml.transaction_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "aml_txe_read" ON aml.transaction_events FOR SELECT TO authenticated USING (public.has_any_aml_role(auth.uid()));
CREATE POLICY "aml_txe_insert" ON aml.transaction_events FOR INSERT TO authenticated WITH CHECK (public.has_aml_write_role(auth.uid()));
CREATE INDEX IF NOT EXISTS idx_aml_txe_tx ON aml.transaction_events(transaction_id, created_at DESC);

CREATE TABLE IF NOT EXISTS aml.counterparty_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES aml.cases(id) ON DELETE CASCADE,
  transaction_id uuid NULL REFERENCES aml.transactions(id) ON DELETE SET NULL,
  party_id uuid NULL REFERENCES aml.transaction_parties(id) ON DELETE SET NULL,
  subject_display_name text NOT NULL,
  subject_type text NOT NULL DEFAULT 'individual',
  status text NOT NULL DEFAULT 'open',
  risk_rating text NULL,
  assigned_analyst_id uuid NULL,
  notes text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON aml.counterparty_cases TO authenticated;
GRANT ALL ON aml.counterparty_cases TO service_role;
ALTER TABLE aml.counterparty_cases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "aml_cpc_read" ON aml.counterparty_cases FOR SELECT TO authenticated USING (public.has_any_aml_role(auth.uid()));
CREATE POLICY "aml_cpc_write" ON aml.counterparty_cases FOR ALL TO authenticated USING (public.has_aml_write_role(auth.uid())) WITH CHECK (public.has_aml_write_role(auth.uid()));
CREATE INDEX IF NOT EXISTS idx_aml_cpc_case ON aml.counterparty_cases(case_id);

CREATE TABLE IF NOT EXISTS aml.counterparty_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  counterparty_case_id uuid NOT NULL REFERENCES aml.counterparty_cases(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES aml.cases(id) ON DELETE CASCADE,
  request_type text NOT NULL,
  channel text NOT NULL DEFAULT 'email',
  status text NOT NULL DEFAULT 'pending',
  due_date date NULL,
  summary text NOT NULL,
  detail text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON aml.counterparty_requests TO authenticated;
GRANT ALL ON aml.counterparty_requests TO service_role;
ALTER TABLE aml.counterparty_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "aml_cpr_read" ON aml.counterparty_requests FOR SELECT TO authenticated USING (public.has_any_aml_role(auth.uid()));
CREATE POLICY "aml_cpr_write" ON aml.counterparty_requests FOR ALL TO authenticated USING (public.has_aml_write_role(auth.uid())) WITH CHECK (public.has_aml_write_role(auth.uid()));
CREATE INDEX IF NOT EXISTS idx_aml_cpr_cpc ON aml.counterparty_requests(counterparty_case_id);

CREATE TABLE IF NOT EXISTS aml.counterparty_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES aml.counterparty_requests(id) ON DELETE CASCADE,
  counterparty_case_id uuid NOT NULL REFERENCES aml.counterparty_cases(id) ON DELETE CASCADE,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  channel text NOT NULL,
  outcome text NOT NULL DEFAULT 'no_response',
  notes text NULL,
  actor_id uuid NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON aml.counterparty_attempts TO authenticated;
GRANT ALL ON aml.counterparty_attempts TO service_role;
ALTER TABLE aml.counterparty_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "aml_cpa_read" ON aml.counterparty_attempts FOR SELECT TO authenticated USING (public.has_any_aml_role(auth.uid()));
CREATE POLICY "aml_cpa_write" ON aml.counterparty_attempts FOR ALL TO authenticated USING (public.has_aml_write_role(auth.uid())) WITH CHECK (public.has_aml_write_role(auth.uid()));
CREATE INDEX IF NOT EXISTS idx_aml_cpa_req ON aml.counterparty_attempts(request_id, attempted_at DESC);

CREATE OR REPLACE FUNCTION aml.tg_set_updated_at() RETURNS trigger
LANGUAGE plpgsql SET search_path = aml, public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_aml_tx_updated') THEN
    CREATE TRIGGER trg_aml_tx_updated BEFORE UPDATE ON aml.transactions FOR EACH ROW EXECUTE FUNCTION aml.tg_set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_aml_txp_updated') THEN
    CREATE TRIGGER trg_aml_txp_updated BEFORE UPDATE ON aml.transaction_parties FOR EACH ROW EXECUTE FUNCTION aml.tg_set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_aml_cpc_updated') THEN
    CREATE TRIGGER trg_aml_cpc_updated BEFORE UPDATE ON aml.counterparty_cases FOR EACH ROW EXECUTE FUNCTION aml.tg_set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_aml_cpr_updated') THEN
    CREATE TRIGGER trg_aml_cpr_updated BEFORE UPDATE ON aml.counterparty_requests FOR EACH ROW EXECUTE FUNCTION aml.tg_set_updated_at();
  END IF;
END $$;

INSERT INTO public.feature_flags (key, value, description)
VALUES ('aml_settlement_gate', '{"enabled": false}'::jsonb,
        'Additive AML pre-settlement compliance gate on Finance Portal unconditional/settlement transitions.')
ON CONFLICT (key) DO NOTHING;
