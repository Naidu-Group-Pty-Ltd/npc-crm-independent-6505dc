-- Phase 7.5: Partner goal tracker
CREATE TABLE public.finance_partner_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  finance_contact_id uuid NOT NULL,
  month_start date NOT NULL,
  settlement_target_count integer,
  settlement_target_amount numeric,
  commission_target_net numeric,
  notes text,
  created_by_finance_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (finance_contact_id, month_start)
);

CREATE INDEX idx_finance_partner_goals_partner_month
  ON public.finance_partner_goals (finance_contact_id, month_start DESC);

ALTER TABLE public.finance_partner_goals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_only_finance_partner_goals"
  ON public.finance_partner_goals
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE TRIGGER trg_finance_partner_goals_updated_at
  BEFORE UPDATE ON public.finance_partner_goals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER PUBLICATION supabase_realtime ADD TABLE public.finance_partner_goals;