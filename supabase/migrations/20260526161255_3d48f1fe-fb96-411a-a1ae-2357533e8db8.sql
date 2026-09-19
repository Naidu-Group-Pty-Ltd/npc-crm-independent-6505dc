
-- ============ CHUNK 6: Lender packet history ============
CREATE TABLE public.purchase_file_lender_packets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_file_id uuid NOT NULL REFERENCES public.purchase_files(id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  lender_name text,
  lender_key text,
  filename text NOT NULL,
  file_count integer NOT NULL DEFAULT 0,
  total_size_bytes bigint,
  missing_required_count integer NOT NULL DEFAULT 0,
  missing_required jsonb NOT NULL DEFAULT '[]'::jsonb,
  quality_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  manifest jsonb NOT NULL DEFAULT '{}'::jsonb,
  cover_sheet_included boolean NOT NULL DEFAULT true,
  generated_by_finance_user_id uuid,
  generated_by_email text,
  download_count integer NOT NULL DEFAULT 0,
  last_downloaded_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.purchase_file_lender_packets TO service_role;
ALTER TABLE public.purchase_file_lender_packets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role manages lender packets"
  ON public.purchase_file_lender_packets FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX idx_pf_lender_packets_file ON public.purchase_file_lender_packets(purchase_file_id, created_at DESC);
CREATE INDEX idx_pf_lender_packets_client ON public.purchase_file_lender_packets(client_id, created_at DESC);

CREATE TRIGGER update_purchase_file_lender_packets_updated_at
  BEFORE UPDATE ON public.purchase_file_lender_packets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER PUBLICATION supabase_realtime ADD TABLE public.purchase_file_lender_packets;

-- ============ CHUNK 7: Settlement runway ============
DO $$ BEGIN
  CREATE TYPE public.pf_settlement_task_key AS ENUM (
    'identity_verified',
    'solicitor_engaged',
    'loan_docs_issued',
    'loan_docs_signed',
    'insurance_arranged',
    'settlement_funds_ready',
    'lender_funder_booked',
    'final_inspection',
    'settlement_attended'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.pf_settlement_task_status AS ENUM (
    'pending','in_progress','completed','blocked','not_applicable'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE public.purchase_file_settlement_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_file_id uuid NOT NULL REFERENCES public.purchase_files(id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  task_key public.pf_settlement_task_key NOT NULL,
  label text NOT NULL,
  description text,
  owner text NOT NULL DEFAULT 'finance', -- finance | client | solicitor | npc
  status public.pf_settlement_task_status NOT NULL DEFAULT 'pending',
  due_offset_days integer,
  due_date date,
  sort_order integer NOT NULL DEFAULT 0,
  is_required boolean NOT NULL DEFAULT true,
  is_auto_seeded boolean NOT NULL DEFAULT false,
  notes text,
  completed_at timestamptz,
  completed_by_finance_user_id uuid,
  completed_by_team_user_id uuid,
  blocked_reason text,
  created_by_finance_user_id uuid,
  created_by_team_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (purchase_file_id, task_key)
);

GRANT ALL ON public.purchase_file_settlement_tasks TO service_role;
ALTER TABLE public.purchase_file_settlement_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role manages settlement tasks"
  ON public.purchase_file_settlement_tasks FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX idx_pf_settlement_tasks_file ON public.purchase_file_settlement_tasks(purchase_file_id, sort_order);
CREATE INDEX idx_pf_settlement_tasks_status ON public.purchase_file_settlement_tasks(status) WHERE status IN ('pending','in_progress','blocked');
CREATE INDEX idx_pf_settlement_tasks_due ON public.purchase_file_settlement_tasks(due_date) WHERE due_date IS NOT NULL AND status IN ('pending','in_progress');

CREATE TRIGGER update_pf_settlement_tasks_updated_at
  BEFORE UPDATE ON public.purchase_file_settlement_tasks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER PUBLICATION supabase_realtime ADD TABLE public.purchase_file_settlement_tasks;

-- ============ Auto-seed on unconditional_approval ============
CREATE OR REPLACE FUNCTION public.seed_settlement_runway(_file_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pf record;
  task_def record;
  computed_due date;
BEGIN
  SELECT id, client_id, settlement_date INTO pf
  FROM public.purchase_files WHERE id = _file_id;
  IF pf IS NULL THEN RETURN; END IF;

  -- Skip if already seeded
  IF EXISTS (SELECT 1 FROM public.purchase_file_settlement_tasks
             WHERE purchase_file_id = _file_id AND is_auto_seeded = true) THEN
    RETURN;
  END IF;

  FOR task_def IN
    SELECT * FROM (VALUES
      ('identity_verified'::public.pf_settlement_task_key,    'Identity verified (VOI complete)',          'finance',   -28, 1, true),
      ('solicitor_engaged'::public.pf_settlement_task_key,    'Solicitor / conveyancer engaged',           'npc',       -28, 2, true),
      ('loan_docs_issued'::public.pf_settlement_task_key,     'Loan documents issued by lender',           'finance',   -21, 3, true),
      ('loan_docs_signed'::public.pf_settlement_task_key,     'Loan documents signed & returned',          'client',    -14, 4, true),
      ('insurance_arranged'::public.pf_settlement_task_key,   'Building insurance arranged (COC sent)',    'client',    -10, 5, true),
      ('settlement_funds_ready'::public.pf_settlement_task_key,'Settlement funds confirmed cleared',       'client',     -3, 6, true),
      ('lender_funder_booked'::public.pf_settlement_task_key, 'Lender funder / PEXA booking confirmed',    'finance',    -3, 7, true),
      ('final_inspection'::public.pf_settlement_task_key,     'Pre-settlement inspection completed',       'client',     -1, 8, true),
      ('settlement_attended'::public.pf_settlement_task_key,  'Settlement attended & funds disbursed',     'solicitor',   0, 9, true)
    ) AS t(task_key, label, owner, offset_days, sort_order, is_required)
  LOOP
    computed_due := CASE
      WHEN pf.settlement_date IS NOT NULL THEN pf.settlement_date + task_def.offset_days
      ELSE NULL
    END;

    INSERT INTO public.purchase_file_settlement_tasks
      (purchase_file_id, client_id, task_key, label, owner,
       due_offset_days, due_date, sort_order, is_required, is_auto_seeded)
    VALUES
      (_file_id, pf.client_id, task_def.task_key, task_def.label, task_def.owner,
       task_def.offset_days, computed_due, task_def.sort_order, task_def.is_required, true)
    ON CONFLICT (purchase_file_id, task_key) DO NOTHING;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.trigger_seed_settlement_runway()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.finance_status = 'unconditional_approval'
     AND (OLD.finance_status IS DISTINCT FROM NEW.finance_status) THEN
    PERFORM public.seed_settlement_runway(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pf_seed_settlement_runway ON public.purchase_files;
CREATE TRIGGER pf_seed_settlement_runway
  AFTER UPDATE OF finance_status ON public.purchase_files
  FOR EACH ROW EXECUTE FUNCTION public.trigger_seed_settlement_runway();
