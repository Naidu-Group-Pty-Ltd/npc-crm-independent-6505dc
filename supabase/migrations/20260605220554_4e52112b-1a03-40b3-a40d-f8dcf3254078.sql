
-- COMMENTS ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.template_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL,
  thread_id UUID NOT NULL,
  parent_id UUID NULL REFERENCES public.template_comments(id) ON DELETE CASCADE,
  page_id TEXT NULL,
  block_id TEXT NULL,
  overlay_id TEXT NULL,
  author_id UUID NULL,
  author_name TEXT NULL,
  body TEXT NOT NULL,
  resolved BOOLEAN NOT NULL DEFAULT false,
  resolved_at TIMESTAMPTZ NULL,
  resolved_by UUID NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.template_comments TO authenticated;
GRANT ALL ON public.template_comments TO service_role;

ALTER TABLE public.template_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tpl_comments_select_auth"
  ON public.template_comments FOR SELECT TO authenticated USING (true);

CREATE POLICY "tpl_comments_insert_auth"
  ON public.template_comments FOR INSERT TO authenticated
  WITH CHECK (author_id IS NULL OR author_id = auth.uid());

CREATE POLICY "tpl_comments_update_own_or_resolve"
  ON public.template_comments FOR UPDATE TO authenticated
  USING (author_id IS NULL OR author_id = auth.uid() OR true)
  WITH CHECK (true);

CREATE POLICY "tpl_comments_delete_own"
  ON public.template_comments FOR DELETE TO authenticated
  USING (author_id IS NULL OR author_id = auth.uid());

CREATE INDEX IF NOT EXISTS template_comments_template_idx
  ON public.template_comments (template_id, created_at DESC);
CREATE INDEX IF NOT EXISTS template_comments_thread_idx
  ON public.template_comments (thread_id, created_at);

-- SHARE LINKS ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.template_share_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL,
  token TEXT NOT NULL UNIQUE,
  label TEXT NULL,
  mode TEXT NOT NULL DEFAULT 'preview',
  theme_id TEXT NULL,
  expires_at TIMESTAMPTZ NULL,
  revoked_at TIMESTAMPTZ NULL,
  created_by UUID NULL,
  view_count INTEGER NOT NULL DEFAULT 0,
  last_viewed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.template_share_links TO authenticated;
GRANT ALL ON public.template_share_links TO service_role;

ALTER TABLE public.template_share_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tpl_share_select_auth"
  ON public.template_share_links FOR SELECT TO authenticated USING (true);

CREATE POLICY "tpl_share_insert_self"
  ON public.template_share_links FOR INSERT TO authenticated
  WITH CHECK (created_by IS NULL OR created_by = auth.uid());

CREATE POLICY "tpl_share_update_self"
  ON public.template_share_links FOR UPDATE TO authenticated
  USING (created_by IS NULL OR created_by = auth.uid())
  WITH CHECK (created_by IS NULL OR created_by = auth.uid());

CREATE POLICY "tpl_share_delete_self"
  ON public.template_share_links FOR DELETE TO authenticated
  USING (created_by IS NULL OR created_by = auth.uid());

CREATE INDEX IF NOT EXISTS template_share_links_template_idx
  ON public.template_share_links (template_id, created_at DESC);

-- Shared updated_at trigger function (idempotent)
CREATE OR REPLACE FUNCTION public.touch_template_collab_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_template_comments_updated_at ON public.template_comments;
CREATE TRIGGER trg_template_comments_updated_at
BEFORE UPDATE ON public.template_comments
FOR EACH ROW EXECUTE FUNCTION public.touch_template_collab_updated_at();

DROP TRIGGER IF EXISTS trg_template_share_updated_at ON public.template_share_links;
CREATE TRIGGER trg_template_share_updated_at
BEFORE UPDATE ON public.template_share_links
FOR EACH ROW EXECUTE FUNCTION public.touch_template_collab_updated_at();

-- Realtime publication
DO $$ BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.template_comments;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;
