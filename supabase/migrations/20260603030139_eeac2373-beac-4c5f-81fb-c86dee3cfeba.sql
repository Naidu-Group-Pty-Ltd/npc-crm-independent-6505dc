CREATE TABLE IF NOT EXISTS public.finance_partner_ui_prefs (
  finance_user_id uuid PRIMARY KEY,
  density text NOT NULL DEFAULT 'comfortable',
  default_landing text NOT NULL DEFAULT 'dashboard',
  mobile_optimized boolean NOT NULL DEFAULT false,
  prefs jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.finance_partner_ui_prefs TO service_role;
ALTER TABLE public.finance_partner_ui_prefs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role manages ui prefs" ON public.finance_partner_ui_prefs FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS trg_finance_partner_ui_prefs_updated ON public.finance_partner_ui_prefs;
CREATE TRIGGER trg_finance_partner_ui_prefs_updated
  BEFORE UPDATE ON public.finance_partner_ui_prefs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();