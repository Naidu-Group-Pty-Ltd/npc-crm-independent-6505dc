
CREATE TABLE IF NOT EXISTS aml.finance_case_handoff_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text NOT NULL UNIQUE,
  case_id uuid NOT NULL REFERENCES aml.cases(id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  finance_user_id uuid NOT NULL,
  finance_contact_id uuid,
  minted_by uuid,
  ip_address text,
  user_agent text,
  is_readonly boolean NOT NULL DEFAULT true,
  expires_at timestamptz NOT NULL,
  redeemed_at timestamptz,
  redeemed_ip text,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS finance_case_handoff_tokens_finance_user_idx
  ON aml.finance_case_handoff_tokens(finance_user_id);
CREATE INDEX IF NOT EXISTS finance_case_handoff_tokens_case_idx
  ON aml.finance_case_handoff_tokens(case_id);
CREATE INDEX IF NOT EXISTS finance_case_handoff_tokens_expires_idx
  ON aml.finance_case_handoff_tokens(expires_at);

ALTER TABLE aml.finance_case_handoff_tokens ENABLE ROW LEVEL SECURITY;
-- No policies: access is exclusively through SECURITY DEFINER edge functions
-- using service_role. RLS default-deny is intentional.

GRANT ALL ON aml.finance_case_handoff_tokens TO service_role;

-- Speed up cross-case duplicate document-reference detection
CREATE INDEX IF NOT EXISTS evidence_references_reference_id_idx
  ON aml.evidence_references(reference_id)
  WHERE reference_id IS NOT NULL;
