
-- Enums
CREATE TYPE public.finance_decision_outcome AS ENUM (
  'green_light','proceed_with_caution','not_suitable','need_more_info',
  'subject_to_valuation','subject_to_lender_review','subject_to_equity','subject_to_deposit'
);

CREATE TYPE public.condition_owner AS ENUM ('client','npc_team','finance_partner','legal','other');

CREATE TYPE public.condition_status AS ENUM ('pending','in_progress','uploaded','satisfied','waived');

CREATE TYPE public.valuation_status AS ENUM ('ordered','access_pending','inspected','returned','disputed','cancelled');

CREATE TYPE public.valuation_result AS ENUM ('on_contract','above_contract','short','pending');

-- ── Finance decisions ──
CREATE TABLE public.purchase_file_finance_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_file_id UUID NOT NULL REFERENCES public.purchase_files(id) ON DELETE CASCADE,
  client_id UUID NOT NULL,
  outcome public.finance_decision_outcome NOT NULL,
  rationale TEXT,
  snapshot_purchase_price NUMERIC,
  snapshot_estimated_rent_weekly NUMERIC,
  snapshot_client_contribution NUMERIC,
  snapshot_max_approved_budget NUMERIC,
  snapshot_lender TEXT,
  decided_by_finance_user_id UUID REFERENCES public.finance_portal_users(id) ON DELETE SET NULL,
  decided_by_team_user_id UUID REFERENCES public.custom_users(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.purchase_file_finance_decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_role_all_pf_decisions ON public.purchase_file_finance_decisions
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE INDEX idx_pf_decisions_file ON public.purchase_file_finance_decisions(purchase_file_id, decided_at DESC);

CREATE TRIGGER trg_pf_decisions_updated_at
  BEFORE UPDATE ON public.purchase_file_finance_decisions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── Conditions ──
CREATE TABLE public.purchase_file_conditions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_file_id UUID NOT NULL REFERENCES public.purchase_files(id) ON DELETE CASCADE,
  client_id UUID NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  owner public.condition_owner NOT NULL DEFAULT 'client',
  status public.condition_status NOT NULL DEFAULT 'pending',
  due_date DATE,
  satisfied_at TIMESTAMPTZ,
  satisfied_by_finance_user_id UUID REFERENCES public.finance_portal_users(id) ON DELETE SET NULL,
  document_id UUID REFERENCES public.finance_portal_documents(id) ON DELETE SET NULL,
  is_auto_generated BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_by_finance_user_id UUID REFERENCES public.finance_portal_users(id) ON DELETE SET NULL,
  created_by_team_user_id UUID REFERENCES public.custom_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.purchase_file_conditions ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_role_all_pf_conditions ON public.purchase_file_conditions
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE INDEX idx_pf_conditions_file ON public.purchase_file_conditions(purchase_file_id, sort_order);
CREATE INDEX idx_pf_conditions_status ON public.purchase_file_conditions(client_id, status);

CREATE TRIGGER trg_pf_conditions_updated_at
  BEFORE UPDATE ON public.purchase_file_conditions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── Valuations ──
CREATE TABLE public.purchase_file_valuations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_file_id UUID NOT NULL REFERENCES public.purchase_files(id) ON DELETE CASCADE,
  client_id UUID NOT NULL,
  valuer TEXT,
  agent_contact TEXT,
  access_required TEXT,
  ordered_date DATE,
  inspected_date DATE,
  returned_date DATE,
  contract_price NUMERIC,
  valuation_amount NUMERIC,
  shortfall NUMERIC,
  result public.valuation_result NOT NULL DEFAULT 'pending',
  status public.valuation_status NOT NULL DEFAULT 'ordered',
  risk_level TEXT CHECK (risk_level IN ('low','medium','high')) DEFAULT 'low',
  next_action TEXT,
  notes TEXT,
  document_id UUID REFERENCES public.finance_portal_documents(id) ON DELETE SET NULL,
  created_by_finance_user_id UUID REFERENCES public.finance_portal_users(id) ON DELETE SET NULL,
  created_by_team_user_id UUID REFERENCES public.custom_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.purchase_file_valuations ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_role_all_pf_valuations ON public.purchase_file_valuations
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE INDEX idx_pf_valuations_file ON public.purchase_file_valuations(purchase_file_id, ordered_date DESC);

CREATE TRIGGER trg_pf_valuations_updated_at
  BEFORE UPDATE ON public.purchase_file_valuations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── Realtime ──
ALTER PUBLICATION supabase_realtime ADD TABLE public.purchase_file_finance_decisions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.purchase_file_conditions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.purchase_file_valuations;

-- ── Audit hook into purchase_file_status_history ──
CREATE OR REPLACE FUNCTION public.log_pf_decision_to_history()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  INSERT INTO public.purchase_file_status_history (purchase_file_id, event_type, from_value, to_value, metadata, created_by)
  VALUES (NEW.purchase_file_id, 'finance_decision_recorded', NULL, NEW.outcome::text,
    jsonb_build_object('decision_id', NEW.id, 'rationale', NEW.rationale),
    NEW.decided_by_team_user_id);
  RETURN NEW;
END $$;
CREATE TRIGGER trg_pf_decision_history
  AFTER INSERT ON public.purchase_file_finance_decisions
  FOR EACH ROW EXECUTE FUNCTION public.log_pf_decision_to_history();

CREATE OR REPLACE FUNCTION public.log_pf_condition_status_to_history()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.purchase_file_status_history (purchase_file_id, event_type, to_value, metadata)
    VALUES (NEW.purchase_file_id, 'condition_added', NEW.title,
      jsonb_build_object('condition_id', NEW.id, 'owner', NEW.owner, 'auto', NEW.is_auto_generated));
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.purchase_file_status_history (purchase_file_id, event_type, from_value, to_value, metadata)
    VALUES (NEW.purchase_file_id, 'condition_status_changed', OLD.status::text, NEW.status::text,
      jsonb_build_object('condition_id', NEW.id, 'title', NEW.title));
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_pf_condition_history
  AFTER INSERT OR UPDATE ON public.purchase_file_conditions
  FOR EACH ROW EXECUTE FUNCTION public.log_pf_condition_status_to_history();

CREATE OR REPLACE FUNCTION public.log_pf_valuation_to_history()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.purchase_file_status_history (purchase_file_id, event_type, to_value, metadata)
    VALUES (NEW.purchase_file_id, 'valuation_ordered', NEW.valuer,
      jsonb_build_object('valuation_id', NEW.id, 'ordered_date', NEW.ordered_date));
  ELSIF NEW.status IS DISTINCT FROM OLD.status OR NEW.result IS DISTINCT FROM OLD.result THEN
    INSERT INTO public.purchase_file_status_history (purchase_file_id, event_type, from_value, to_value, metadata)
    VALUES (NEW.purchase_file_id, 'valuation_updated', OLD.status::text, NEW.status::text,
      jsonb_build_object('valuation_id', NEW.id, 'result', NEW.result, 'valuation_amount', NEW.valuation_amount, 'shortfall', NEW.shortfall));
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_pf_valuation_history
  AFTER INSERT OR UPDATE ON public.purchase_file_valuations
  FOR EACH ROW EXECUTE FUNCTION public.log_pf_valuation_to_history();

-- ── Auto-seed default conditions when finance_status → conditional_approval ──
CREATE OR REPLACE FUNCTION public.seed_default_conditions_on_conditional_approval()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.finance_status = 'conditional_approval'
     AND (OLD.finance_status IS NULL OR OLD.finance_status <> 'conditional_approval')
     AND NOT EXISTS (SELECT 1 FROM public.purchase_file_conditions WHERE purchase_file_id = NEW.id AND is_auto_generated = true) THEN
    INSERT INTO public.purchase_file_conditions
      (purchase_file_id, client_id, title, description, owner, status, is_auto_generated, sort_order)
    VALUES
      (NEW.id, NEW.client_id, 'Satisfactory valuation', 'Lender-acceptable valuation at or above contract price', 'finance_partner', 'pending', true, 10),
      (NEW.id, NEW.client_id, 'Signed contract of sale', 'Counter-signed copy delivered to lender', 'client', 'pending', true, 20),
      (NEW.id, NEW.client_id, 'Evidence of deposit funds', 'Statement showing cleared deposit funds', 'client', 'pending', true, 30),
      (NEW.id, NEW.client_id, 'Insurance — certificate of currency', 'Building insurance noting lender as interested party', 'client', 'pending', true, 40),
      (NEW.id, NEW.client_id, 'Loan documents executed', 'Borrower-signed loan offer pack', 'client', 'pending', true, 50),
      (NEW.id, NEW.client_id, 'Conditions cleared with lender', 'All lender-specific conditions discharged', 'finance_partner', 'pending', true, 60),
      (NEW.id, NEW.client_id, 'Solicitor / conveyancer engaged', 'Settlement representation confirmed', 'legal', 'pending', true, 70);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_seed_default_conditions
  AFTER INSERT OR UPDATE OF finance_status ON public.purchase_files
  FOR EACH ROW EXECUTE FUNCTION public.seed_default_conditions_on_conditional_approval();

-- ── Notification types ──
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (type = ANY (ARRAY[
  'report_generated','report_failed','info','call_completed','report_generation_completed',
  'report_generation_failed','portal_report_requested','agreement_generated','new_ghl_contact',
  'new_marketing_lead','missed_call','client_reminder_overdue','client_reminder_due',
  'client_reminder_upcoming','report_request','email_received','conversation_shared',
  'game_plan_created','game_plan_updated','game_plan_milestone_completed','conversation_reply',
  'lender_submission_status','lender_rate_alert','client_data_updated','portal_message_received',
  'finance_portal_message_received',
  'document_requirement_requested','document_requirement_uploaded','document_requirement_verified',
  'finance_decision_recorded','condition_added','condition_satisfied','valuation_returned','valuation_short'
]));
