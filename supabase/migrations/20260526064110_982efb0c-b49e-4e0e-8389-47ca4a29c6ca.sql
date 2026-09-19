
-- Phase 1: Purchase Files foundation

-- 1. Enums
CREATE TYPE public.purchase_file_type AS ENUM (
  'existing_property','off_the_plan','house_and_land','land_only','build_only',
  'dual_occupancy','smsf','commercial','refinance_equity'
);

CREATE TYPE public.purchase_file_status AS ENUM (
  'draft','active','on_hold','at_risk','settled','cancelled'
);

CREATE TYPE public.purchase_finance_status AS ENUM (
  'not_started','docs_requested','docs_received','in_review','pre_approved',
  'purchase_specific_review','application_lodged','conditional_approval',
  'valuation_pending','valuation_returned','unconditional_approval',
  'ready_for_settlement','settled','at_risk'
);

CREATE TYPE public.purchase_critical_date_type AS ENUM (
  'offer_submitted','contract_received','cooling_off_expiry','finance_clause_expiry',
  'building_pest_deadline','deposit_due','valuation_due','loan_approval_target','settlement'
);

CREATE TYPE public.purchase_critical_date_status AS ENUM ('on_track','due_soon','overdue','completed');

-- 2. purchase_files
CREATE TABLE public.purchase_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  title text NOT NULL,
  purchase_type public.purchase_file_type NOT NULL DEFAULT 'existing_property',
  status public.purchase_file_status NOT NULL DEFAULT 'draft',
  finance_status public.purchase_finance_status NOT NULL DEFAULT 'not_started',
  property_address text,
  property_suburb text,
  property_state text,
  property_postcode text,
  purchase_price numeric,
  deposit_amount numeric,
  max_approved_budget numeric,
  lender text,
  estimated_rent_weekly numeric,
  client_contribution numeric,
  settlement_date date,
  finance_clause_date date,
  assigned_finance_user_id uuid REFERENCES public.finance_portal_users(id) ON DELETE SET NULL,
  assigned_team_user_id uuid REFERENCES public.custom_users(id) ON DELETE SET NULL,
  risk_level text CHECK (risk_level IS NULL OR risk_level IN ('low','medium','high')),
  notes text,
  created_by uuid,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_purchase_files_client ON public.purchase_files(client_id);
CREATE INDEX idx_purchase_files_status ON public.purchase_files(status);
CREATE INDEX idx_purchase_files_finance_user ON public.purchase_files(assigned_finance_user_id);

ALTER TABLE public.purchase_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all_purchase_files" ON public.purchase_files
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 3. critical dates
CREATE TABLE public.purchase_file_critical_dates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_file_id uuid NOT NULL REFERENCES public.purchase_files(id) ON DELETE CASCADE,
  date_type public.purchase_critical_date_type NOT NULL,
  due_date date,
  status public.purchase_critical_date_status NOT NULL DEFAULT 'on_track',
  notes text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_purchase_file_critical_dates_file ON public.purchase_file_critical_dates(purchase_file_id);
CREATE INDEX idx_purchase_file_critical_dates_due ON public.purchase_file_critical_dates(due_date);
ALTER TABLE public.purchase_file_critical_dates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all_pf_dates" ON public.purchase_file_critical_dates
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 4. status history
CREATE TABLE public.purchase_file_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_file_id uuid NOT NULL REFERENCES public.purchase_files(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  from_value text,
  to_value text,
  actor_id uuid,
  actor_kind text,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_pf_status_history_file ON public.purchase_file_status_history(purchase_file_id, created_at DESC);
ALTER TABLE public.purchase_file_status_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all_pf_history" ON public.purchase_file_status_history
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 5. updated_at triggers
CREATE TRIGGER trg_purchase_files_updated_at
  BEFORE UPDATE ON public.purchase_files
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_pf_critical_dates_updated_at
  BEFORE UPDATE ON public.purchase_file_critical_dates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 6. status history trigger on purchase_files
CREATE OR REPLACE FUNCTION public.log_purchase_file_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.purchase_file_status_history (purchase_file_id, event_type, to_value, actor_id, payload)
    VALUES (NEW.id, 'created', NEW.status::text, NEW.created_by, jsonb_build_object('finance_status', NEW.finance_status));
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.purchase_file_status_history (purchase_file_id, event_type, from_value, to_value)
    VALUES (NEW.id, 'status_changed', OLD.status::text, NEW.status::text);
  END IF;
  IF NEW.finance_status IS DISTINCT FROM OLD.finance_status THEN
    INSERT INTO public.purchase_file_status_history (purchase_file_id, event_type, from_value, to_value)
    VALUES (NEW.id, 'finance_status_changed', OLD.finance_status::text, NEW.finance_status::text);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_log_purchase_file_status
  AFTER INSERT OR UPDATE ON public.purchase_files
  FOR EACH ROW EXECUTE FUNCTION public.log_purchase_file_status_change();

-- 7. realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE public.purchase_files;
ALTER PUBLICATION supabase_realtime ADD TABLE public.purchase_file_critical_dates;
ALTER PUBLICATION supabase_realtime ADD TABLE public.purchase_file_status_history;
