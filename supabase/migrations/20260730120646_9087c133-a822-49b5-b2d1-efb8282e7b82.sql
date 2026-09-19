-- ─────────────── ENUMS ───────────────
DO $$ BEGIN
  CREATE TYPE public.legal_critical_date_type AS ENUM (
    'contract_date','exchange','cooling_off_expiry','deposit_due','balance_deposit_due',
    'finance_approval','building_pest','strata_report','survey','sunset_date',
    'notice_to_complete','stamp_duty_due','settlement','pexa_lodgement','other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.legal_critical_date_status AS ENUM (
    'pending','at_risk','satisfied','waived','extended','missed','not_applicable'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.legal_settlement_task_key AS ENUM (
    'title_search','contract_review','requisitions_on_title','transfer_prepared',
    'stamp_duty_assessed','stamp_duty_paid','discharge_authority','pexa_workspace',
    'settlement_figures','adjustments_agreed','final_inspection','funds_confirmed',
    'settlement_booked','post_settlement_notices'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.legal_settlement_task_status AS ENUM (
    'not_started','in_progress','blocked','complete','not_applicable'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─────────────── CRITICAL DATES ───────────────
CREATE TABLE IF NOT EXISTS public.legal_matter_critical_dates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_matter_id uuid NOT NULL REFERENCES public.legal_matters(id) ON DELETE CASCADE,
  date_type public.legal_critical_date_type NOT NULL DEFAULT 'other',
  label text NOT NULL,
  due_date date,
  due_time time,
  status public.legal_critical_date_status NOT NULL DEFAULT 'pending',
  owner text NOT NULL DEFAULT 'solicitor',
  is_key boolean NOT NULL DEFAULT false,
  source text NOT NULL DEFAULT 'manual',
  reminder_days integer[] NOT NULL DEFAULT ARRAY[7,3,1],
  last_reminder_sent_at timestamptz,
  satisfied_at timestamptz,
  satisfied_by_type text,
  satisfied_by_solicitor_user_id uuid REFERENCES public.solicitor_portal_users(id) ON DELETE SET NULL,
  extended_from_date date,
  visible_to_client boolean NOT NULL DEFAULT false,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_legal_critical_dates_matter
  ON public.legal_matter_critical_dates(legal_matter_id, due_date);
CREATE INDEX IF NOT EXISTS idx_legal_critical_dates_status
  ON public.legal_matter_critical_dates(status, due_date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_legal_critical_dates_derived_unique
  ON public.legal_matter_critical_dates(legal_matter_id, date_type)
  WHERE source = 'matter_field';

GRANT ALL ON public.legal_matter_critical_dates TO service_role;
ALTER TABLE public.legal_matter_critical_dates ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "legal_matter_critical_dates_service_role_only"
    ON public.legal_matter_critical_dates FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP TRIGGER IF EXISTS trg_legal_critical_dates_updated_at ON public.legal_matter_critical_dates;
CREATE TRIGGER trg_legal_critical_dates_updated_at
  BEFORE UPDATE ON public.legal_matter_critical_dates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ─────────────── SETTLEMENT RUNWAY TASKS ───────────────
CREATE TABLE IF NOT EXISTS public.legal_matter_settlement_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_matter_id uuid NOT NULL REFERENCES public.legal_matters(id) ON DELETE CASCADE,
  task_key public.legal_settlement_task_key NOT NULL,
  label text NOT NULL,
  sequence integer NOT NULL DEFAULT 0,
  status public.legal_settlement_task_status NOT NULL DEFAULT 'not_started',
  owner text NOT NULL DEFAULT 'solicitor',
  offset_days integer,
  due_date date,
  completed_at timestamptz,
  completed_by_type text,
  completed_by_solicitor_user_id uuid REFERENCES public.solicitor_portal_users(id) ON DELETE SET NULL,
  blocked_reason text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (legal_matter_id, task_key)
);

CREATE INDEX IF NOT EXISTS idx_legal_settlement_tasks_matter
  ON public.legal_matter_settlement_tasks(legal_matter_id, sequence);

GRANT ALL ON public.legal_matter_settlement_tasks TO service_role;
ALTER TABLE public.legal_matter_settlement_tasks ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "legal_matter_settlement_tasks_service_role_only"
    ON public.legal_matter_settlement_tasks FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP TRIGGER IF EXISTS trg_legal_settlement_tasks_updated_at ON public.legal_matter_settlement_tasks;
CREATE TRIGGER trg_legal_settlement_tasks_updated_at
  BEFORE UPDATE ON public.legal_matter_settlement_tasks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ─────────────── DERIVED CRITICAL DATE SYNC ───────────────
CREATE OR REPLACE FUNCTION public.sync_legal_matter_derived_dates()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  mapping jsonb := jsonb_build_object(
    'contract_date',      jsonb_build_array('contract_date',      'Contract date'),
    'exchange',           jsonb_build_array('exchange_date',      'Exchange'),
    'cooling_off_expiry', jsonb_build_array('cooling_off_expiry', 'Cooling-off expiry'),
    'finance_approval',   jsonb_build_array('finance_clause_date','Finance clause'),
    'building_pest',      jsonb_build_array('building_pest_date', 'Building & pest'),
    'sunset_date',        jsonb_build_array('sunset_date',        'Sunset date'),
    'settlement',         jsonb_build_array('settlement_date',    'Settlement')
  );
  k text;
  col text;
  lbl text;
  val date;
BEGIN
  FOR k IN SELECT jsonb_object_keys(mapping) LOOP
    col := mapping -> k ->> 0;
    lbl := mapping -> k ->> 1;
    EXECUTE format('SELECT ($1).%I', col) INTO val USING NEW;

    IF val IS NULL THEN
      DELETE FROM public.legal_matter_critical_dates
        WHERE legal_matter_id = NEW.id
          AND source = 'matter_field'
          AND date_type = k::public.legal_critical_date_type
          AND status = 'pending';
    ELSE
      INSERT INTO public.legal_matter_critical_dates
        (legal_matter_id, date_type, label, due_date, source, is_key, visible_to_client)
      VALUES (NEW.id, k::public.legal_critical_date_type, lbl, val, 'matter_field', true, false)
      ON CONFLICT (legal_matter_id, date_type) WHERE source = 'matter_field'
      DO UPDATE SET
        due_date = EXCLUDED.due_date,
        label = EXCLUDED.label,
        updated_at = now();
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_legal_matters_derived_dates ON public.legal_matters;
CREATE TRIGGER trg_legal_matters_derived_dates
  AFTER INSERT OR UPDATE OF contract_date, exchange_date, cooling_off_expiry,
    finance_clause_date, building_pest_date, sunset_date, settlement_date
  ON public.legal_matters
  FOR EACH ROW EXECUTE FUNCTION public.sync_legal_matter_derived_dates();

-- ─────────────── SETTLEMENT RUNWAY SEEDING ───────────────
CREATE OR REPLACE FUNCTION public.seed_legal_matter_settlement_tasks(_matter_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m record;
  inserted integer := 0;
  t record;
BEGIN
  SELECT * INTO m FROM public.legal_matters WHERE id = _matter_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  FOR t IN
    SELECT * FROM (VALUES
      ('title_search',            'Title search & plan',                 10, -35, 'solicitor'),
      ('contract_review',         'Contract review complete',            20, -35, 'solicitor'),
      ('requisitions_on_title',   'Requisitions on title served',        30, -28, 'solicitor'),
      ('transfer_prepared',       'Transfer documents prepared',         40, -21, 'solicitor'),
      ('stamp_duty_assessed',     'Stamp duty assessed',                 50, -21, 'solicitor'),
      ('stamp_duty_paid',         'Stamp duty paid',                     60, -7,  'client'),
      ('discharge_authority',     'Discharge / incoming mortgage docs',  70, -14, 'lender'),
      ('pexa_workspace',          'PEXA workspace created & invited',    80, -14, 'solicitor'),
      ('settlement_figures',      'Settlement figures issued',           90, -7,  'solicitor'),
      ('adjustments_agreed',      'Adjustments agreed with other side', 100, -5,  'solicitor'),
      ('final_inspection',        'Final inspection completed',         110, -2,  'client'),
      ('funds_confirmed',         'Funds to complete confirmed',        120, -2,  'lender'),
      ('settlement_booked',       'Settlement booked in PEXA',          130, -1,  'solicitor'),
      ('post_settlement_notices', 'Post-settlement notices issued',     140, 3,   'solicitor')
    ) AS v(task_key, label, seq, offset_days, owner)
  LOOP
    INSERT INTO public.legal_matter_settlement_tasks
      (legal_matter_id, task_key, label, sequence, offset_days, owner, due_date)
    VALUES (
      _matter_id,
      t.task_key::public.legal_settlement_task_key,
      t.label,
      t.seq,
      t.offset_days,
      t.owner,
      CASE WHEN m.settlement_date IS NOT NULL
           THEN m.settlement_date + (t.offset_days || ' days')::interval
           ELSE NULL END::date
    )
    ON CONFLICT (legal_matter_id, task_key) DO NOTHING;
    inserted := inserted + 1;
  END LOOP;

  RETURN inserted;
END;
$$;

CREATE OR REPLACE FUNCTION public.auto_seed_legal_settlement_tasks()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('unconditional','pre_settlement')
     AND (TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status) THEN
    PERFORM public.seed_legal_matter_settlement_tasks(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_legal_matters_seed_settlement ON public.legal_matters;
CREATE TRIGGER trg_legal_matters_seed_settlement
  AFTER INSERT OR UPDATE OF status ON public.legal_matters
  FOR EACH ROW EXECUTE FUNCTION public.auto_seed_legal_settlement_tasks();

-- Keep runway due dates aligned when the settlement date moves.
CREATE OR REPLACE FUNCTION public.resync_legal_settlement_task_dates()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.settlement_date IS DISTINCT FROM OLD.settlement_date AND NEW.settlement_date IS NOT NULL THEN
    UPDATE public.legal_matter_settlement_tasks
      SET due_date = (NEW.settlement_date + (offset_days || ' days')::interval)::date,
          updated_at = now()
    WHERE legal_matter_id = NEW.id
      AND offset_days IS NOT NULL
      AND status <> 'complete';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_legal_matters_resync_runway ON public.legal_matters;
CREATE TRIGGER trg_legal_matters_resync_runway
  AFTER UPDATE OF settlement_date ON public.legal_matters
  FOR EACH ROW EXECUTE FUNCTION public.resync_legal_settlement_task_dates();

-- ─────────────── REALTIME ───────────────
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.legal_matter_critical_dates;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.legal_matter_settlement_tasks;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;