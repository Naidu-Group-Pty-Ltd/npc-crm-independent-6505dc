-- Phase 7 (finance reconciliation) — canonical finance-request records for the
-- Command Center ↔ Finance Portal workflow (directive §15.4).
--
-- Additive and reversible. Requests are created by AML staff, delivered to the
-- assigned finance partner through the finance-portal channel, and answered
-- with funding information or clarification text. Submissions become
-- aml.finance_comparisons rows (the existing comparison/discrepancy engine);
-- this table records the request lifecycle and finance-safe wording only.
--
-- client_id and purchase_file_id are denormalised onto the request at
-- creation so the finance-portal function can scope reads via
-- finance_portal_client_assignments without touching aml.cases.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS aml.finance_requests;

CREATE TABLE IF NOT EXISTS aml.finance_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES aml.cases(id) ON DELETE CASCADE,
  client_id uuid,
  purchase_file_id uuid,
  kind text NOT NULL CHECK (kind IN (
    'funding_information', 'financial_evidence', 'clarification')),
  subject text NOT NULL,
  -- Finance-safe wording authored by staff. Never auto-populated from
  -- discrepancy internals; the linked discrepancy stays server-side.
  message text NOT NULL,
  discrepancy_id uuid,
  status text NOT NULL DEFAULT 'open' CHECK (status IN (
    'open', 'submitted', 'clarification_required', 'resolved', 'cancelled')),
  response_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  responded_at timestamptz,
  responded_by_label text,
  comparison_id uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid,
  resolution_note text
);

CREATE INDEX IF NOT EXISTS idx_aml_finreq_case ON aml.finance_requests(case_id);
CREATE INDEX IF NOT EXISTS idx_aml_finreq_client ON aml.finance_requests(client_id);
CREATE INDEX IF NOT EXISTS idx_aml_finreq_pf ON aml.finance_requests(purchase_file_id);
CREATE INDEX IF NOT EXISTS idx_aml_finreq_open
  ON aml.finance_requests(client_id)
  WHERE status IN ('open', 'clarification_required');

DROP TRIGGER IF EXISTS trg_aml_finance_requests_updated_at ON aml.finance_requests;
CREATE TRIGGER trg_aml_finance_requests_updated_at
  BEFORE UPDATE ON aml.finance_requests
  FOR EACH ROW EXECUTE FUNCTION aml.touch_updated_at();

-- Default-deny RLS; SECURITY DEFINER edge functions only. The finance-portal
-- function applies its own assignment scoping and finance-safe projection.
ALTER TABLE aml.finance_requests ENABLE ROW LEVEL SECURITY;
GRANT ALL ON aml.finance_requests TO service_role;
