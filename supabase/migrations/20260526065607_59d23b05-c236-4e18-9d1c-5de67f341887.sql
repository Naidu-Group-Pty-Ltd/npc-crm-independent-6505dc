
-- Phase 2: Document Requirements Matrix

-- Status of a requirement instance
CREATE TYPE public.document_requirement_status AS ENUM (
  'required', 'requested', 'uploaded', 'verified', 'waived', 'expired'
);

-- Who owns the action on a requirement
CREATE TYPE public.document_requirement_owner AS ENUM (
  'client', 'finance_partner', 'npc_team', 'legal', 'other'
);

-- Functional category grouping
CREATE TYPE public.document_requirement_category AS ENUM (
  'identity', 'income_payg', 'income_self_employed', 'bank_statements',
  'existing_loans', 'assets', 'liabilities', 'purchase_docs',
  'deposit_proof', 'valuation', 'loan_approval', 'settlement', 'other'
);

-- Template rows: defaults per purchase_type
CREATE TABLE public.document_requirement_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_type public.purchase_file_type NOT NULL,
  category public.document_requirement_category NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  default_owner public.document_requirement_owner NOT NULL DEFAULT 'client',
  is_required BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.document_requirement_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_role_all_dr_templates ON public.document_requirement_templates
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE INDEX idx_dr_templates_purchase_type ON public.document_requirement_templates(purchase_type, sort_order);

-- Instances: one row per requirement on a purchase file
CREATE TABLE public.document_requirement_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_file_id UUID NOT NULL REFERENCES public.purchase_files(id) ON DELETE CASCADE,
  client_id UUID NOT NULL,
  template_id UUID REFERENCES public.document_requirement_templates(id) ON DELETE SET NULL,
  category public.document_requirement_category NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  owner public.document_requirement_owner NOT NULL DEFAULT 'client',
  status public.document_requirement_status NOT NULL DEFAULT 'required',
  is_required BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  visible_to_client BOOLEAN NOT NULL DEFAULT true,
  visible_to_finance BOOLEAN NOT NULL DEFAULT true,
  visible_to_npc BOOLEAN NOT NULL DEFAULT true,
  visible_to_legal BOOLEAN NOT NULL DEFAULT false,
  requested_at TIMESTAMPTZ,
  requested_by_finance_user_id UUID REFERENCES public.finance_portal_users(id) ON DELETE SET NULL,
  request_message TEXT,
  uploaded_at TIMESTAMPTZ,
  document_id UUID REFERENCES public.finance_portal_documents(id) ON DELETE SET NULL,
  verified_at TIMESTAMPTZ,
  verified_by_finance_user_id UUID REFERENCES public.finance_portal_users(id) ON DELETE SET NULL,
  expiry_date DATE,
  notes TEXT,
  created_by_finance_user_id UUID REFERENCES public.finance_portal_users(id) ON DELETE SET NULL,
  created_by_team_user_id UUID REFERENCES public.custom_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.document_requirement_instances ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_role_all_dr_instances ON public.document_requirement_instances
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE INDEX idx_dr_instances_file ON public.document_requirement_instances(purchase_file_id, sort_order);
CREATE INDEX idx_dr_instances_client_status ON public.document_requirement_instances(client_id, status);

-- Updated_at triggers
CREATE TRIGGER trg_dr_templates_updated_at
  BEFORE UPDATE ON public.document_requirement_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_dr_instances_updated_at
  BEFORE UPDATE ON public.document_requirement_instances
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.document_requirement_templates;
ALTER PUBLICATION supabase_realtime ADD TABLE public.document_requirement_instances;

-- Extend notifications check to allow new document-request types
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (type = ANY (ARRAY[
  'report_generated','report_failed','info','call_completed','report_generation_completed',
  'report_generation_failed','portal_report_requested','agreement_generated','new_ghl_contact',
  'new_marketing_lead','missed_call','client_reminder_overdue','client_reminder_due',
  'client_reminder_upcoming','report_request','email_received','conversation_shared',
  'game_plan_created','game_plan_updated','game_plan_milestone_completed','conversation_reply',
  'lender_submission_status','lender_rate_alert','client_data_updated','portal_message_received',
  'finance_portal_message_received',
  'document_requirement_requested','document_requirement_uploaded','document_requirement_verified'
]));

-- Seed default templates per purchase_type
INSERT INTO public.document_requirement_templates (purchase_type, category, label, description, default_owner, is_required, sort_order) VALUES
-- Identity (all types)
('existing_property','identity','Photo ID (driver licence or passport)','Front and back of primary photo identification','client',true,10),
('existing_property','identity','Secondary ID (Medicare or proof of age)',NULL,'client',true,20),
-- Income PAYG
('existing_property','income_payg','Last 2 payslips','Most recent consecutive payslips','client',true,30),
('existing_property','income_payg','PAYG payment summary or tax return',NULL,'client',true,40),
('existing_property','income_payg','Employment contract or letter','Required for new employment or probation','client',false,50),
-- Bank statements
('existing_property','bank_statements','Last 3 months transaction account statements',NULL,'client',true,60),
('existing_property','bank_statements','Last 3 months savings account statements',NULL,'client',true,70),
-- Existing loans
('existing_property','existing_loans','Existing home loan statements (last 6 months)',NULL,'client',false,80),
('existing_property','existing_loans','Personal loan / car loan statements',NULL,'client',false,90),
('existing_property','existing_loans','Credit card statements (latest)',NULL,'client',true,100),
-- Assets
('existing_property','assets','Superannuation statement (latest)',NULL,'client',true,110),
('existing_property','assets','Investment / share holdings statement',NULL,'client',false,120),
-- Liabilities
('existing_property','liabilities','HECS / HELP balance statement',NULL,'client',false,130),
-- Purchase docs
('existing_property','purchase_docs','Signed contract of sale','Required once property is selected','client',true,140),
('existing_property','purchase_docs','Section 32 / vendor statement',NULL,'client',true,150),
-- Deposit proof
('existing_property','deposit_proof','Evidence of deposit / genuine savings','3 months savings history','client',true,160),
('existing_property','deposit_proof','Gift letter (if applicable)',NULL,'client',false,170),
-- Valuation
('existing_property','valuation','Valuation report','Ordered by broker / lender','finance_partner',true,180),
-- Loan approval
('existing_property','loan_approval','Conditional approval letter',NULL,'finance_partner',true,190),
('existing_property','loan_approval','Unconditional approval letter',NULL,'finance_partner',true,200),
-- Settlement
('existing_property','settlement','Building & pest inspection report',NULL,'client',true,210),
('existing_property','settlement','Insurance certificate of currency','Required prior to settlement','client',true,220),
('existing_property','settlement','Settlement statement',NULL,'legal',true,230);

-- Mirror identity/income/banks/loans/credit/super/HECS/deposit/valuation/loan_approval/settlement defaults to other purchase types
INSERT INTO public.document_requirement_templates (purchase_type, category, label, description, default_owner, is_required, sort_order)
SELECT pt.purchase_type, t.category, t.label, t.description, t.default_owner, t.is_required, t.sort_order
FROM (VALUES
  ('off_the_plan'::public.purchase_file_type),
  ('house_and_land'::public.purchase_file_type),
  ('land_only'::public.purchase_file_type),
  ('build_only'::public.purchase_file_type),
  ('dual_occupancy'::public.purchase_file_type),
  ('smsf'::public.purchase_file_type),
  ('commercial'::public.purchase_file_type),
  ('refinance_equity'::public.purchase_file_type)
) AS pt(purchase_type)
CROSS JOIN public.document_requirement_templates t
WHERE t.purchase_type = 'existing_property'
  AND t.category IN ('identity','income_payg','bank_statements','existing_loans','assets','liabilities','deposit_proof','loan_approval');

-- Purchase-type specific additions
INSERT INTO public.document_requirement_templates (purchase_type, category, label, description, default_owner, is_required, sort_order) VALUES
('off_the_plan','purchase_docs','OTP contract of sale',NULL,'client',true,140),
('off_the_plan','purchase_docs','Disclosure statement',NULL,'client',true,150),
('off_the_plan','purchase_docs','Builder/developer details and ABN',NULL,'client',true,155),
('off_the_plan','settlement','Final occupancy certificate','At completion','client',true,230),
('house_and_land','purchase_docs','Land contract of sale',NULL,'client',true,140),
('house_and_land','purchase_docs','Building / construction contract',NULL,'client',true,145),
('house_and_land','purchase_docs','Council-approved plans and specifications',NULL,'client',true,150),
('house_and_land','purchase_docs','Fixed-price tender / quote',NULL,'client',true,155),
('land_only','purchase_docs','Land contract of sale',NULL,'client',true,140),
('build_only','purchase_docs','Building / construction contract',NULL,'client',true,140),
('build_only','purchase_docs','Council-approved plans and specifications',NULL,'client',true,150),
('dual_occupancy','purchase_docs','Dual-occupancy development plans',NULL,'client',true,140),
('dual_occupancy','purchase_docs','DA approval (where applicable)',NULL,'client',false,145),
('smsf','identity','SMSF trust deed',NULL,'client',true,11),
('smsf','identity','Corporate trustee documents',NULL,'client',true,12),
('smsf','income_self_employed','Last 2 years SMSF financial statements and tax returns',NULL,'client',true,30),
('smsf','purchase_docs','Bare trust deed / custodian trust',NULL,'client',true,140),
('smsf','purchase_docs','Signed contract of sale',NULL,'client',true,145),
('commercial','income_self_employed','Last 2 years business tax returns and financials',NULL,'client',true,30),
('commercial','income_self_employed','BAS statements (last 4 quarters)',NULL,'client',true,35),
('commercial','purchase_docs','Commercial contract of sale',NULL,'client',true,140),
('commercial','purchase_docs','Existing lease agreements',NULL,'client',false,145),
('refinance_equity','existing_loans','Current loan statements (last 6 months)',NULL,'client',true,80),
('refinance_equity','purchase_docs','Most recent rates notice',NULL,'client',true,140),
('refinance_equity','purchase_docs','Purpose of funds declaration',NULL,'client',true,145);

-- Self-employed defaults applied to all (only if not already added)
INSERT INTO public.document_requirement_templates (purchase_type, category, label, description, default_owner, is_required, sort_order)
SELECT pt.purchase_type, 'income_self_employed'::public.document_requirement_category, t.label, t.description, t.default_owner, false, t.sort_order
FROM (VALUES
  ('existing_property'::public.purchase_file_type),
  ('off_the_plan'::public.purchase_file_type),
  ('house_and_land'::public.purchase_file_type),
  ('land_only'::public.purchase_file_type),
  ('build_only'::public.purchase_file_type),
  ('dual_occupancy'::public.purchase_file_type),
  ('refinance_equity'::public.purchase_file_type)
) AS pt(purchase_type)
CROSS JOIN (VALUES
  ('Last 2 years personal tax returns', 'For self-employed applicants', 'client'::public.document_requirement_owner, 45),
  ('Last 2 years business tax returns and financials', NULL, 'client'::public.document_requirement_owner, 46),
  ('Accountant letter', 'Confirming income / trading position', 'client'::public.document_requirement_owner, 48)
) AS t(label, description, default_owner, sort_order);
