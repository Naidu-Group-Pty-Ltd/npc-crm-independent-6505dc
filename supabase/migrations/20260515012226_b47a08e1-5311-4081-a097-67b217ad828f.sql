
-- Snippets
CREATE TABLE public.email_copilot_snippets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL,
  shortcut text,
  body text NOT NULL,
  category text DEFAULT 'general',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_email_copilot_snippets_user ON public.email_copilot_snippets(user_id);
ALTER TABLE public.email_copilot_snippets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "snippets_service_role_only_select" ON public.email_copilot_snippets FOR SELECT USING (false);
CREATE POLICY "snippets_service_role_only_ins" ON public.email_copilot_snippets FOR INSERT WITH CHECK (false);
CREATE POLICY "snippets_service_role_only_upd" ON public.email_copilot_snippets FOR UPDATE USING (false);
CREATE POLICY "snippets_service_role_only_del" ON public.email_copilot_snippets FOR DELETE USING (false);

CREATE TRIGGER trg_email_snippets_updated_at
BEFORE UPDATE ON public.email_copilot_snippets
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Scheduled sends
CREATE TABLE public.email_copilot_scheduled_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  mailbox_source text NOT NULL DEFAULT 'admin',
  recipient text NOT NULL,
  cc_recipients text[] DEFAULT '{}',
  bcc_recipients text[] DEFAULT '{}',
  subject text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  attachments jsonb DEFAULT '[]'::jsonb,
  original_email_id uuid,
  scheduled_for timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX idx_scheduled_sends_status_due ON public.email_copilot_scheduled_sends(status, scheduled_for);
CREATE INDEX idx_scheduled_sends_user ON public.email_copilot_scheduled_sends(user_id);
ALTER TABLE public.email_copilot_scheduled_sends ENABLE ROW LEVEL SECURITY;
CREATE POLICY "scheduled_service_role_only_select" ON public.email_copilot_scheduled_sends FOR SELECT USING (false);
CREATE POLICY "scheduled_service_role_only_ins" ON public.email_copilot_scheduled_sends FOR INSERT WITH CHECK (false);
CREATE POLICY "scheduled_service_role_only_upd" ON public.email_copilot_scheduled_sends FOR UPDATE USING (false);
CREATE POLICY "scheduled_service_role_only_del" ON public.email_copilot_scheduled_sends FOR DELETE USING (false);

CREATE TRIGGER trg_email_scheduled_updated_at
BEFORE UPDATE ON public.email_copilot_scheduled_sends
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
