
ALTER TABLE public.purchase_files
  ADD COLUMN IF NOT EXISTS kanban_position numeric;

CREATE INDEX IF NOT EXISTS idx_pf_kanban_status_position
  ON public.purchase_files(finance_status, kanban_position);

CREATE INDEX IF NOT EXISTS idx_pf_last_partner_action_at
  ON public.purchase_files(last_partner_action_at);

CREATE TABLE IF NOT EXISTS public.purchase_file_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_file_id uuid NOT NULL REFERENCES public.purchase_files(id) ON DELETE CASCADE,
  finance_contact_id uuid REFERENCES public.finance_agent_contacts(id) ON DELETE SET NULL,
  outcome text NOT NULL CHECK (outcome IN ('won','lost','withdrawn')),
  reason_category text,
  reason_detail text,
  lender text,
  loan_amount numeric,
  recorded_by uuid,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pfo_pf ON public.purchase_file_outcomes(purchase_file_id);
CREATE INDEX IF NOT EXISTS idx_pfo_partner ON public.purchase_file_outcomes(finance_contact_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_pfo_outcome ON public.purchase_file_outcomes(outcome, recorded_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_file_outcomes TO authenticated;
GRANT ALL ON public.purchase_file_outcomes TO service_role;

ALTER TABLE public.purchase_file_outcomes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service role manages purchase_file_outcomes" ON public.purchase_file_outcomes;
CREATE POLICY "service role manages purchase_file_outcomes"
  ON public.purchase_file_outcomes
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
