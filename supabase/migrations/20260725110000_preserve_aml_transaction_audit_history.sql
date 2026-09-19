-- AML transaction records and their hash-chained events are compliance evidence.
-- Retain both when the legacy delete operation is requested.
ALTER TABLE aml.transactions
  ADD COLUMN IF NOT EXISTS archived_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS archived_by uuid NULL;

-- Archival is performed only by the service-role Edge Function after its MLRO
-- check and audit-event append. Keep ordinary transaction editing available to
-- authenticated AML writers, but do not expose either archive marker through
-- direct PostgREST updates.
REVOKE DELETE, UPDATE ON aml.transactions FROM authenticated;
GRANT UPDATE (
  id,
  case_id,
  purchase_file_id,
  kind,
  status,
  reference,
  property_address,
  contract_date,
  settlement_date,
  original_settlement_date,
  purchase_price,
  deposit_amount,
  currency,
  source,
  notes,
  metadata,
  created_by,
  created_at,
  updated_at
) ON aml.transactions TO authenticated;

DROP POLICY IF EXISTS "aml_tx_write" ON aml.transactions;
CREATE POLICY "aml_tx_insert" ON aml.transactions
  FOR INSERT TO authenticated
  WITH CHECK (public.has_aml_write_role(auth.uid()));
CREATE POLICY "aml_tx_update" ON aml.transactions
  FOR UPDATE TO authenticated
  USING (public.has_aml_write_role(auth.uid()))
  WITH CHECK (public.has_aml_write_role(auth.uid()));

ALTER TABLE aml.transaction_events
  DROP CONSTRAINT IF EXISTS transaction_events_transaction_id_fkey;
ALTER TABLE aml.transaction_events
  ADD CONSTRAINT transaction_events_transaction_id_fkey
  FOREIGN KEY (transaction_id) REFERENCES aml.transactions(id) ON DELETE RESTRICT;
