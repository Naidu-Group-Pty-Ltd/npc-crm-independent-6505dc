
-- =========================================================
-- Phase 7.3 — Nudge sequences
-- =========================================================

CREATE TABLE IF NOT EXISTS public.finance_portal_nudge_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  finance_user_id uuid NULL REFERENCES public.finance_portal_users(id) ON DELETE CASCADE,
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'custom',
  description text,
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.finance_portal_nudge_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all_nudge_templates" ON public.finance_portal_nudge_templates
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER trg_nudge_templates_updated_at
  BEFORE UPDATE ON public.finance_portal_nudge_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


CREATE TABLE IF NOT EXISTS public.finance_portal_nudge_sequences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_file_id uuid NOT NULL REFERENCES public.purchase_files(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES public.finance_portal_nudge_templates(id) ON DELETE RESTRICT,
  started_by_finance_user_id uuid REFERENCES public.finance_portal_users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'active',     -- active | paused | completed | cancelled
  current_step integer NOT NULL DEFAULT 0,
  pause_reason text,
  last_step_sent_at timestamptz,
  next_run_at timestamptz,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nudge_seq_client ON public.finance_portal_nudge_sequences(client_id);
CREATE INDEX IF NOT EXISTS idx_nudge_seq_pf ON public.finance_portal_nudge_sequences(purchase_file_id);
CREATE INDEX IF NOT EXISTS idx_nudge_seq_status_next ON public.finance_portal_nudge_sequences(status, next_run_at);

ALTER TABLE public.finance_portal_nudge_sequences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all_nudge_sequences" ON public.finance_portal_nudge_sequences
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER trg_nudge_sequences_updated_at
  BEFORE UPDATE ON public.finance_portal_nudge_sequences
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


CREATE TABLE IF NOT EXISTS public.finance_portal_nudge_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id uuid NOT NULL REFERENCES public.finance_portal_nudge_sequences(id) ON DELETE CASCADE,
  step_index integer NOT NULL,
  channel text NOT NULL DEFAULT 'portal_message',
  sent_at timestamptz NOT NULL DEFAULT now(),
  message_id uuid,
  error text
);

CREATE INDEX IF NOT EXISTS idx_nudge_sends_seq ON public.finance_portal_nudge_sends(sequence_id);

ALTER TABLE public.finance_portal_nudge_sends ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all_nudge_sends" ON public.finance_portal_nudge_sends
  FOR ALL TO service_role USING (true) WITH CHECK (true);


-- Realtime publication
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'finance_portal_nudge_sequences'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.finance_portal_nudge_sequences;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'finance_portal_nudge_templates'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.finance_portal_nudge_templates;
  END IF;
END $$;


-- Auto-pause when client replies via portal
CREATE OR REPLACE FUNCTION public.auto_pause_nudges_on_client_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.sender_type = 'client' THEN
    UPDATE public.finance_portal_nudge_sequences
       SET status = 'paused',
           pause_reason = 'client_replied',
           updated_at = now()
     WHERE client_id = NEW.client_id
       AND status = 'active';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_pause_nudges ON public.client_portal_messages;
CREATE TRIGGER trg_auto_pause_nudges
  AFTER INSERT ON public.client_portal_messages
  FOR EACH ROW EXECUTE FUNCTION public.auto_pause_nudges_on_client_message();


-- Seed default templates (workspace-wide; finance_user_id NULL)
INSERT INTO public.finance_portal_nudge_templates (finance_user_id, name, kind, description, steps)
VALUES
(NULL,
 'Document chase (3-step)',
 'doc_chase',
 'Friendly 3-touch chase for outstanding document requests. Pauses automatically when the client replies.',
 '[
   {"day_offset":0,"channel":"portal_message","subject":"Quick reminder on your documents","body":"Hi {first_name}, just a quick note — we are still waiting on a few documents to keep your application moving. You can upload them straight from your portal in under 2 minutes."},
   {"day_offset":3,"channel":"portal_message","subject":"Still missing a few items","body":"Hi {first_name}, following up on the documents we requested. Lenders are tightening turnaround times, so getting these in this week will help us protect your settlement date."},
   {"day_offset":7,"channel":"portal_message","subject":"Final reminder before we escalate","body":"Hi {first_name}, this is my last automated reminder. If anything is unclear about what we need or how to upload it, reply to this message and I will jump on a call."}
 ]'::jsonb
),
(NULL,
 'Pre-settlement (5-day)',
 'pre_settlement',
 'Daily countdown leading up to settlement: insurance, final inspection, funds, ID, settlement-day brief.',
 '[
   {"day_offset":0,"channel":"portal_message","subject":"Settlement is 5 business days away","body":"Hi {first_name}, settlement is approaching. Please confirm your building insurance is in place and certificate of currency is uploaded to your portal."},
   {"day_offset":1,"channel":"portal_message","subject":"Pre-settlement inspection","body":"Hi {first_name}, time to book your pre-settlement inspection with the agent. Let us know if you need help arranging it."},
   {"day_offset":2,"channel":"portal_message","subject":"Funds-to-complete check","body":"Hi {first_name}, please ensure cleared funds-to-complete are in your nominated account 2 business days before settlement."},
   {"day_offset":3,"channel":"portal_message","subject":"ID and signing","body":"Hi {first_name}, the lender may request a final ID check. Please respond within 24 hours if you receive a request."},
   {"day_offset":4,"channel":"portal_message","subject":"Settlement day brief","body":"Hi {first_name}, here is what to expect on settlement day. Funds typically clear by 3pm; we will message you the moment it is unconditional."}
 ]'::jsonb
),
(NULL,
 'Refi anniversary',
 'refi_anniversary',
 'Annual touch-point: rate review offer + portal nudge to update financial profile.',
 '[
   {"day_offset":0,"channel":"portal_message","subject":"Time for your annual rate review","body":"Hi {first_name}, it has been a year since we settled your loan. Rates have moved — let me run a complimentary review to make sure you are still on the sharpest deal."},
   {"day_offset":7,"channel":"portal_message","subject":"Quick update?","body":"Hi {first_name}, no pressure — just checking if you would like me to pull a quick refi comparison. Reply yes and I will have it back to you in 48 hours."}
 ]'::jsonb
)
ON CONFLICT DO NOTHING;
