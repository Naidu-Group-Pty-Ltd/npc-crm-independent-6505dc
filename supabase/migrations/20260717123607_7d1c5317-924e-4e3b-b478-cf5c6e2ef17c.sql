
CREATE TABLE IF NOT EXISTS aml.transaction_obligations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  case_id UUID NOT NULL,
  transaction_id UUID NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('ttr','ifti','smr_candidate','structuring_suspected')),
  trigger_reason TEXT NOT NULL,
  threshold_amount NUMERIC,
  observed_amount NUMERIC,
  currency TEXT DEFAULT 'AUD',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','acknowledged','report_created','waived')),
  linked_report_id UUID,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  acknowledged_by UUID,
  acknowledged_at TIMESTAMPTZ,
  waived_by UUID,
  waived_at TIMESTAMPTZ,
  waive_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (transaction_id, kind)
);

CREATE INDEX IF NOT EXISTS transaction_obligations_case_idx
  ON aml.transaction_obligations (case_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS transaction_obligations_tx_idx
  ON aml.transaction_obligations (transaction_id);

ALTER TABLE aml.transaction_obligations ENABLE ROW LEVEL SECURITY;

-- schema is only exposed via service_role through edge functions
CREATE POLICY "service_role manages transaction_obligations"
  ON aml.transaction_obligations FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION aml.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_transaction_obligations_updated_at ON aml.transaction_obligations;
CREATE TRIGGER trg_transaction_obligations_updated_at
BEFORE UPDATE ON aml.transaction_obligations
FOR EACH ROW EXECUTE FUNCTION aml.set_updated_at();
