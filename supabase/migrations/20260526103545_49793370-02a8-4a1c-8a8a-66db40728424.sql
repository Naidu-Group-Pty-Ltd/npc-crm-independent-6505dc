-- F1 — Threaded entity comments
CREATE TABLE public.purchase_file_entity_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_file_id uuid NOT NULL,
  entity_type text NOT NULL CHECK (entity_type IN ('condition','document','valuation','decision','date','file','general')),
  entity_id uuid,
  parent_id uuid REFERENCES public.purchase_file_entity_comments(id) ON DELETE CASCADE,
  body text NOT NULL,
  visibility text NOT NULL DEFAULT 'internal_npc' CHECK (visibility IN ('shared','internal_npc')),
  author_type text NOT NULL CHECK (author_type IN ('finance','staff','client')),
  author_id uuid,
  author_name text,
  mentions uuid[] DEFAULT ARRAY[]::uuid[],
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_pfec_pf_entity ON public.purchase_file_entity_comments (purchase_file_id, entity_type, entity_id, created_at);
CREATE INDEX idx_pfec_parent ON public.purchase_file_entity_comments (parent_id);
ALTER TABLE public.purchase_file_entity_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_only_pfec" ON public.purchase_file_entity_comments
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE TRIGGER trg_pfec_updated_at BEFORE UPDATE ON public.purchase_file_entity_comments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
ALTER PUBLICATION supabase_realtime ADD TABLE public.purchase_file_entity_comments;

-- H2 — Per-partner notification routing
CREATE TABLE public.finance_partner_notification_prefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  finance_contact_id uuid NOT NULL,
  event_type text NOT NULL,
  channels text[] NOT NULL DEFAULT ARRAY['in_app']::text[],
  quiet_hours_start time,
  quiet_hours_end time,
  timezone text DEFAULT 'Australia/Sydney',
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (finance_contact_id, event_type)
);
CREATE INDEX idx_fpnp_partner ON public.finance_partner_notification_prefs (finance_contact_id);
ALTER TABLE public.finance_partner_notification_prefs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_only_fpnp" ON public.finance_partner_notification_prefs
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE TRIGGER trg_fpnp_updated_at BEFORE UPDATE ON public.finance_partner_notification_prefs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
ALTER PUBLICATION supabase_realtime ADD TABLE public.finance_partner_notification_prefs;

-- H3 — Partner light-touch branding
CREATE TABLE public.finance_partner_branding (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  finance_contact_id uuid NOT NULL UNIQUE,
  logo_storage_path text,
  accent_hsl text,
  company_display_name text,
  tagline text,
  updated_by_finance_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.finance_partner_branding ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_only_fpb" ON public.finance_partner_branding
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE TRIGGER trg_fpb_updated_at BEFORE UPDATE ON public.finance_partner_branding
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
ALTER PUBLICATION supabase_realtime ADD TABLE public.finance_partner_branding;

-- Private storage bucket for partner logos
INSERT INTO storage.buckets (id, name, public)
VALUES ('finance-partner-branding', 'finance-partner-branding', false)
ON CONFLICT (id) DO NOTHING;