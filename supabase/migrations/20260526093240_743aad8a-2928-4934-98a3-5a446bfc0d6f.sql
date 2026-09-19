-- Phase 7.1 — Partner Cockpit foundations

-- 1. Watchers: a partner can subscribe to a PF they aren't assigned to
CREATE TABLE IF NOT EXISTS public.finance_portal_pf_watchers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_file_id uuid NOT NULL REFERENCES public.purchase_files(id) ON DELETE CASCADE,
  finance_user_id uuid NOT NULL REFERENCES public.finance_portal_users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (purchase_file_id, finance_user_id)
);
CREATE INDEX IF NOT EXISTS idx_pf_watchers_user ON public.finance_portal_pf_watchers(finance_user_id);
ALTER TABLE public.finance_portal_pf_watchers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON public.finance_portal_pf_watchers FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 2. Saved views: per partner, per list scope
CREATE TABLE IF NOT EXISTS public.finance_portal_saved_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  finance_user_id uuid NOT NULL REFERENCES public.finance_portal_users(id) ON DELETE CASCADE,
  scope text NOT NULL CHECK (scope IN ('purchase_files', 'clients')),
  name text NOT NULL,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort jsonb,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_saved_views_user_scope ON public.finance_portal_saved_views(finance_user_id, scope);
CREATE UNIQUE INDEX IF NOT EXISTS uq_saved_views_default
  ON public.finance_portal_saved_views(finance_user_id, scope)
  WHERE is_default;
ALTER TABLE public.finance_portal_saved_views ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON public.finance_portal_saved_views FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER trg_saved_views_updated_at
  BEFORE UPDATE ON public.finance_portal_saved_views
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Last-partner-action tracking on purchase_files
ALTER TABLE public.purchase_files
  ADD COLUMN IF NOT EXISTS last_partner_action_at timestamptz;

-- Seed from existing data
UPDATE public.purchase_files
   SET last_partner_action_at = updated_at
 WHERE last_partner_action_at IS NULL;

-- Trigger: bump last_partner_action_at when status_history entry is added by a finance user
CREATE OR REPLACE FUNCTION public.bump_pf_last_partner_action()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.actor_type IS NULL OR NEW.actor_type IN ('finance_partner', 'finance_user', 'partner') THEN
    UPDATE public.purchase_files
       SET last_partner_action_at = now()
     WHERE id = NEW.purchase_file_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bump_pf_last_partner_action ON public.purchase_file_status_history;
CREATE TRIGGER trg_bump_pf_last_partner_action
  AFTER INSERT ON public.purchase_file_status_history
  FOR EACH ROW EXECUTE FUNCTION public.bump_pf_last_partner_action();

-- 4. Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.finance_portal_pf_watchers;
ALTER PUBLICATION supabase_realtime ADD TABLE public.finance_portal_saved_views;
