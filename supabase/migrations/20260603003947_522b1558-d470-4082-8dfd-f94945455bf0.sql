
-- ── Finance Portal: Message/Note Templates ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.finance_partner_message_templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_finance_contact_id UUID NULL REFERENCES public.finance_portal_users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('message','note','doc_request','sms')),
  category TEXT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  merge_tags TEXT[] NOT NULL DEFAULT '{}',
  is_shared BOOLEAN NOT NULL DEFAULT false,
  use_count INTEGER NOT NULL DEFAULT 0,
  last_used_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fpmt_owner ON public.finance_partner_message_templates(owner_finance_contact_id);
CREATE INDEX IF NOT EXISTS idx_fpmt_kind ON public.finance_partner_message_templates(kind);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.finance_partner_message_templates TO authenticated;
GRANT ALL ON public.finance_partner_message_templates TO service_role;
ALTER TABLE public.finance_partner_message_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role full access fpmt" ON public.finance_partner_message_templates
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER update_fpmt_updated_at
BEFORE UPDATE ON public.finance_partner_message_templates
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── Finance Portal: Smart Snoozes ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.finance_partner_snoozes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  finance_contact_id UUID NOT NULL REFERENCES public.finance_portal_users(id) ON DELETE CASCADE,
  purchase_file_id UUID NULL REFERENCES public.purchase_files(id) ON DELETE CASCADE,
  client_id UUID NULL,
  scope TEXT NOT NULL DEFAULT 'purchase_file' CHECK (scope IN ('purchase_file','client','general')),
  snooze_until TIMESTAMPTZ NOT NULL,
  reason TEXT NULL,
  raw_input TEXT NULL,
  notified BOOLEAN NOT NULL DEFAULT false,
  cleared_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fps_contact ON public.finance_partner_snoozes(finance_contact_id);
CREATE INDEX IF NOT EXISTS idx_fps_due ON public.finance_partner_snoozes(snooze_until) WHERE notified = false AND cleared_at IS NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.finance_partner_snoozes TO authenticated;
GRANT ALL ON public.finance_partner_snoozes TO service_role;
ALTER TABLE public.finance_partner_snoozes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role full access fps" ON public.finance_partner_snoozes
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER update_fps_updated_at
BEFORE UPDATE ON public.finance_partner_snoozes
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── Seed shared system templates ──────────────────────────────────────
INSERT INTO public.finance_partner_message_templates (owner_finance_contact_id, kind, category, title, body, merge_tags, is_shared)
VALUES
  (NULL, 'message', 'Approvals', 'Conditional Approval Received',
   'Hi {{client_first_name}}, great news — {{lender}} has issued conditional approval on your purchase at {{property_address}}. We just need a few more items to push to unconditional. I''ll list them in the next message. — {{partner_name}}',
   ARRAY['client_first_name','lender','property_address','partner_name'], true),
  (NULL, 'message', 'Doc Chases', 'Docs Reminder #1',
   'Hi {{client_first_name}}, just a quick nudge for the outstanding documents on your file. Could you upload them via the portal when you get a moment? Happy to walk you through it. — {{partner_name}}',
   ARRAY['client_first_name','partner_name'], true),
  (NULL, 'message', 'Doc Chases', 'Docs Reminder #2 (Firmer)',
   'Hi {{client_first_name}}, following up again on the outstanding documents. Without them we can''t progress to {{next_status}}, which puts your {{finance_clause_date}} finance clause at risk. Please prioritise this today if possible. — {{partner_name}}',
   ARRAY['client_first_name','next_status','finance_clause_date','partner_name'], true),
  (NULL, 'message', 'Settlement', 'Settlement Confirmed',
   'Congratulations {{client_first_name}} — settlement on {{property_address}} is confirmed for {{settlement_date}}. We''ll be in touch right after to wrap up. — {{partner_name}}',
   ARRAY['client_first_name','property_address','settlement_date','partner_name'], true),
  (NULL, 'message', 'Valuation', 'Valuation Ordered',
   'Hi {{client_first_name}}, {{lender}} has ordered a valuation on {{property_address}}. Typical turnaround is 3-5 business days. I''ll let you know as soon as it lands. — {{partner_name}}',
   ARRAY['client_first_name','lender','property_address','partner_name'], true),
  (NULL, 'note', 'Internal', 'Valuation Concern Logged',
   'Valuation came in {{shortfall_amount}} short of contract price. Options: 1) request review, 2) reduce loan amount, 3) renegotiate with vendor. Discussed with client and they prefer option {{client_choice}}.',
   ARRAY['shortfall_amount','client_choice'], true),
  (NULL, 'doc_request', 'Standard Docs', 'Payslips x2 + Bank Statements',
   'Please upload your two most recent payslips and the last 90 days of bank statements for all accounts (transactional + savings).',
   ARRAY[]::text[], true),
  (NULL, 'doc_request', 'Standard Docs', 'Contract of Sale',
   'Please upload the signed contract of sale and section 32 (or equivalent) for {{property_address}}.',
   ARRAY['property_address'], true);
