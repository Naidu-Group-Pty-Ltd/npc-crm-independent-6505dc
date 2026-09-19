-- Finance Portal Comms (Batch 3 #13-#18) infrastructure
-- Translation cache
CREATE TABLE IF NOT EXISTS public.finance_message_translations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_kind text NOT NULL CHECK (source_kind IN ('portal','ghl','outlook','staff_note','finance_thread')),
  source_id text NOT NULL,
  target_lang text NOT NULL,
  source_lang text,
  translated_text text NOT NULL,
  model text,
  requested_by_finance_contact_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_fmt_source UNIQUE (source_kind, source_id, target_lang)
);

GRANT SELECT, INSERT ON public.finance_message_translations TO authenticated;
GRANT ALL ON public.finance_message_translations TO service_role;

ALTER TABLE public.finance_message_translations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages translations"
ON public.finance_message_translations FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_fmt_lookup ON public.finance_message_translations(source_kind, source_id);

-- Email open tracking (read receipts for outbound email)
CREATE TABLE IF NOT EXISTS public.finance_email_opens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tracking_token text NOT NULL UNIQUE,
  ghl_message_id text,
  outlook_message_id text,
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  purchase_file_id uuid REFERENCES public.purchase_files(id) ON DELETE CASCADE,
  finance_contact_id uuid,
  recipient_email text,
  subject text,
  opened_at timestamptz,
  open_count int NOT NULL DEFAULT 0,
  last_ip text,
  last_user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.finance_email_opens TO authenticated;
GRANT ALL ON public.finance_email_opens TO service_role;

ALTER TABLE public.finance_email_opens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages email opens"
ON public.finance_email_opens FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_feo_pf ON public.finance_email_opens(purchase_file_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feo_client ON public.finance_email_opens(client_id, created_at DESC);

-- Outbound comms log: unified record of broker-initiated messages across SMS/WhatsApp/Email/Portal,
-- bound to a purchase_file for the unified inbox + delivery state tracking.
CREATE TABLE IF NOT EXISTS public.finance_outbound_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_file_id uuid REFERENCES public.purchase_files(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  finance_contact_id uuid,
  channel text NOT NULL CHECK (channel IN ('sms','whatsapp','email','portal','call_log')),
  recipient text,
  subject text,
  body text NOT NULL,
  provider text,
  provider_message_id text,
  ghl_conversation_id text,
  status text NOT NULL DEFAULT 'sent' CHECK (status IN ('queued','sent','delivered','read','failed')),
  error_message text,
  template_id uuid REFERENCES public.finance_partner_message_templates(id) ON DELETE SET NULL,
  tracking_token text,
  delivered_at timestamptz,
  read_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.finance_outbound_messages TO authenticated;
GRANT ALL ON public.finance_outbound_messages TO service_role;

ALTER TABLE public.finance_outbound_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages outbound messages"
ON public.finance_outbound_messages FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_fom_pf ON public.finance_outbound_messages(purchase_file_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fom_client ON public.finance_outbound_messages(client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fom_finance ON public.finance_outbound_messages(finance_contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fom_token ON public.finance_outbound_messages(tracking_token) WHERE tracking_token IS NOT NULL;

CREATE TRIGGER trg_fom_updated_at
BEFORE UPDATE ON public.finance_outbound_messages
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();