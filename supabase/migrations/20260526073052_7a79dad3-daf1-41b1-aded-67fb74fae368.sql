
-- ============================================================
-- Phase 5: Notes split, Activity log, Risk register,
-- Borrowing snapshot, Commission linkage, Automations
-- ============================================================

-- 1. Notes visibility ----------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.client_note_visibility AS ENUM ('shared', 'internal_npc');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.client_notes
  ADD COLUMN IF NOT EXISTS visibility public.client_note_visibility NOT NULL DEFAULT 'shared';

CREATE INDEX IF NOT EXISTS idx_client_notes_visibility ON public.client_notes(client_id, visibility);

-- 2. Risk register -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.purchase_file_risks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_file_id uuid NOT NULL REFERENCES public.purchase_files(id) ON DELETE CASCADE,
  client_id       uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  category        text NOT NULL CHECK (category IN ('finance','valuation','documents','client','legal','property','timing','market','other')),
  severity        text NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
  title           text NOT NULL,
  description     text,
  owner           text NOT NULL DEFAULT 'finance' CHECK (owner IN ('finance','client','npc','legal','broker','other')),
  due_date        date,
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','mitigated','resolved','accepted')),
  resolution_note text,
  resolved_at     timestamptz,
  resolved_by_finance_user_id uuid,
  created_by_finance_user_id  uuid,
  created_by_team_user_id     uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pf_risks_file ON public.purchase_file_risks(purchase_file_id, status, severity);
CREATE INDEX IF NOT EXISTS idx_pf_risks_client ON public.purchase_file_risks(client_id);

ALTER TABLE public.purchase_file_risks ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY service_role_all_pf_risks ON public.purchase_file_risks
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER PUBLICATION supabase_realtime ADD TABLE public.purchase_file_risks;

CREATE OR REPLACE FUNCTION public.update_pf_risks_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_update_pf_risks_updated_at ON public.purchase_file_risks;
CREATE TRIGGER trg_update_pf_risks_updated_at
BEFORE UPDATE ON public.purchase_file_risks
FOR EACH ROW EXECUTE FUNCTION public.update_pf_risks_updated_at();

-- Audit risks into status history
CREATE OR REPLACE FUNCTION public.log_pf_risk_to_history()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_event text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_event := 'risk_added';
    INSERT INTO public.purchase_file_status_history (purchase_file_id, event_type, to_value, payload)
    VALUES (NEW.purchase_file_id, v_event, NEW.severity,
      jsonb_build_object('risk_id', NEW.id, 'title', NEW.title, 'category', NEW.category, 'owner', NEW.owner));
  ELSIF TG_OP = 'UPDATE' AND (OLD.status IS DISTINCT FROM NEW.status OR OLD.severity IS DISTINCT FROM NEW.severity) THEN
    v_event := CASE WHEN OLD.status IS DISTINCT FROM NEW.status THEN 'risk_status_changed' ELSE 'risk_severity_changed' END;
    INSERT INTO public.purchase_file_status_history (purchase_file_id, event_type, from_value, to_value, payload)
    VALUES (NEW.purchase_file_id, v_event,
      COALESCE(OLD.status, OLD.severity), COALESCE(NEW.status, NEW.severity),
      jsonb_build_object('risk_id', NEW.id, 'title', NEW.title));
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_log_pf_risk_to_history ON public.purchase_file_risks;
CREATE TRIGGER trg_log_pf_risk_to_history
AFTER INSERT OR UPDATE ON public.purchase_file_risks
FOR EACH ROW EXECUTE FUNCTION public.log_pf_risk_to_history();

-- 3. Borrowing-capacity snapshot on purchase file ------------------------------
ALTER TABLE public.purchase_files
  ADD COLUMN IF NOT EXISTS borrowing_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS borrowing_snapshot_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS borrowing_snapshot_updated_by_finance_user_id uuid;

-- 4. Commission linkage --------------------------------------------------------
ALTER TABLE public.finance_partner_commissions
  ADD COLUMN IF NOT EXISTS purchase_file_id uuid REFERENCES public.purchase_files(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS milestone text CHECK (milestone IN
    ('referred','lodged','conditional_approval','unconditional_approval','settled','statement_received','paid'));

CREATE INDEX IF NOT EXISTS idx_fpc_purchase_file ON public.finance_partner_commissions(purchase_file_id);

-- 5. Extend notifications type constraint --------------------------------------
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (
  type = ANY (ARRAY[
    'report_generated','report_failed','info','call_completed','report_generation_completed','report_generation_failed',
    'portal_report_requested','agreement_generated','new_ghl_contact','new_marketing_lead','missed_call',
    'client_reminder_overdue','client_reminder_due','client_reminder_upcoming','report_request','email_received',
    'conversation_shared','game_plan_created','game_plan_updated','game_plan_milestone_completed','conversation_reply',
    'lender_submission_status','lender_rate_alert','client_data_updated','portal_message_received',
    'finance_portal_message_received','document_requirement_requested','document_requirement_uploaded',
    'document_requirement_verified','finance_decision_recorded','condition_added','condition_satisfied',
    'valuation_returned','valuation_short',
    -- Phase 5
    'risk_added','risk_escalated','risk_resolved',
    'purchase_file_missing_docs_reminder','purchase_file_finance_clause_t5','purchase_file_finance_clause_t2',
    'purchase_file_valuation_overdue','purchase_file_settlement_t7','purchase_file_unconditional_approval'
  ])
);

-- 6. Auto-notify on unconditional approval -------------------------------------
CREATE OR REPLACE FUNCTION public.notify_on_unconditional_approval()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_team_user uuid;
BEGIN
  IF NEW.finance_status = 'unconditional_approval' AND OLD.finance_status IS DISTINCT FROM NEW.finance_status THEN
    -- Notify assigned NPC team user (if any)
    v_team_user := NEW.assigned_team_user_id;
    IF v_team_user IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, title, message, metadata)
      VALUES (v_team_user, 'purchase_file_unconditional_approval',
        'Unconditional approval received',
        COALESCE(NEW.title, 'Purchase file') || ' is unconditionally approved.',
        jsonb_build_object('purchase_file_id', NEW.id, 'client_id', NEW.client_id, 'lender', NEW.lender));
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_notify_unconditional_approval ON public.purchase_files;
CREATE TRIGGER trg_notify_unconditional_approval
AFTER UPDATE ON public.purchase_files
FOR EACH ROW EXECUTE FUNCTION public.notify_on_unconditional_approval();

-- 7. Activity feed view (unified timeline) -------------------------------------
CREATE OR REPLACE VIEW public.purchase_file_activity_feed AS
  SELECT
    h.id,
    h.purchase_file_id,
    h.created_at,
    'status_history'::text AS source,
    h.event_type,
    h.from_value,
    h.to_value,
    h.actor_id,
    h.actor_kind,
    h.payload
  FROM public.purchase_file_status_history h
  UNION ALL
  SELECT
    d.id,
    d.purchase_file_id,
    d.uploaded_at AS created_at,
    'document'::text AS source,
    'document_uploaded'::text AS event_type,
    NULL::text AS from_value,
    d.status::text AS to_value,
    NULL::uuid AS actor_id,
    'finance'::text AS actor_kind,
    jsonb_build_object('label', d.label, 'category', d.category, 'document_id', d.document_id) AS payload
  FROM public.document_requirement_instances d
  WHERE d.purchase_file_id IS NOT NULL AND d.uploaded_at IS NOT NULL;

GRANT SELECT ON public.purchase_file_activity_feed TO service_role;
