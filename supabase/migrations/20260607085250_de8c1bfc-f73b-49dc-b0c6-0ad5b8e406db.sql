
-- 1) Widen client_note_visibility enum (idempotent)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid='public.client_note_visibility'::regtype AND enumlabel='client_only') THEN
    ALTER TYPE public.client_note_visibility ADD VALUE 'client_only';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid='public.client_note_visibility'::regtype AND enumlabel='finance_only') THEN
    ALTER TYPE public.client_note_visibility ADD VALUE 'finance_only';
  END IF;
END $$;

-- 2) Extend notifications type check (drop & recreate with additions)
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (
  type = ANY (ARRAY[
    'report_generated','report_failed','info','call_completed','report_generation_completed',
    'report_generation_failed','portal_report_requested','agreement_generated','new_ghl_contact',
    'new_marketing_lead','missed_call','client_reminder_overdue','client_reminder_due','client_reminder_upcoming',
    'report_request','email_received','conversation_shared','game_plan_created','game_plan_updated',
    'game_plan_milestone_completed','conversation_reply','lender_submission_status','lender_rate_alert',
    'client_data_updated','portal_message_received','finance_portal_message_received',
    'document_requirement_requested','document_requirement_uploaded','document_requirement_verified',
    'finance_decision_recorded','condition_added','condition_satisfied','valuation_returned',
    'valuation_short','risk_added','risk_escalated','risk_resolved',
    'purchase_file_missing_docs_reminder','purchase_file_finance_clause_t5','purchase_file_finance_clause_t2',
    'purchase_file_valuation_overdue','purchase_file_settlement_t7','purchase_file_unconditional_approval',
    'purchase_file_linked','purchase_file_unlinked',
    -- new for tri-portal sync
    'note_added','message_sent','purchase_file_created'
  ])
);
