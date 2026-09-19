
CREATE TABLE IF NOT EXISTS public.lender_playbooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lender_key text NOT NULL UNIQUE,
  lender_label text NOT NULL,
  quirks text,
  document_rules text,
  bdm_name text,
  bdm_email text,
  bdm_phone text,
  typical_turnaround_days_override integer,
  rate_band_pa numeric(5,2),
  rate_notes text,
  is_active boolean NOT NULL DEFAULT true,
  updated_by_finance_user_id uuid REFERENCES public.finance_portal_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lender_playbooks_active ON public.lender_playbooks(is_active);

ALTER TABLE public.lender_playbooks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all_lender_playbooks" ON public.lender_playbooks
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER trg_lender_playbooks_updated_at
  BEFORE UPDATE ON public.lender_playbooks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname='public' AND tablename='lender_playbooks'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.lender_playbooks;
  END IF;
END $$;
