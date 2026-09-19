CREATE TABLE IF NOT EXISTS public.purchase_file_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_file_id UUID REFERENCES public.purchase_files(id) ON DELETE CASCADE,
  client_id UUID,
  client_deal_id UUID,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('finance_partner','client','team_user','system','superadmin')),
  actor_finance_user_id UUID,
  actor_team_user_id UUID,
  actor_client_id UUID,
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info','notice','warn','critical')),
  category TEXT NOT NULL CHECK (category IN ('sensitive_access','security','document','decision','system','data_change','export','consent')),
  action TEXT NOT NULL,
  target_type TEXT,
  target_id UUID,
  fields_accessed TEXT[],
  description TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address TEXT,
  user_agent TEXT,
  retention_class TEXT NOT NULL DEFAULT 'standard_7y',
  is_redacted BOOLEAN NOT NULL DEFAULT false,
  redacted_at TIMESTAMPTZ,
  prev_hash TEXT,
  row_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT ALL ON public.purchase_file_audit_events TO service_role;

ALTER TABLE public.purchase_file_audit_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service role full access purchase_file_audit_events"
ON public.purchase_file_audit_events FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_pf_audit_events_pf ON public.purchase_file_audit_events(purchase_file_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pf_audit_events_client ON public.purchase_file_audit_events(client_id, created_at DESC) WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pf_audit_events_severity ON public.purchase_file_audit_events(severity, created_at DESC) WHERE severity IN ('warn','critical');
CREATE INDEX IF NOT EXISTS idx_pf_audit_events_category ON public.purchase_file_audit_events(category, created_at DESC);

-- Canonical row hash (SHA-256 hex)
CREATE OR REPLACE FUNCTION public.compute_audit_row_hash(
  _prev_hash TEXT,
  _purchase_file_id UUID,
  _actor_type TEXT,
  _actor_id UUID,
  _category TEXT,
  _action TEXT,
  _target_type TEXT,
  _target_id UUID,
  _metadata JSONB,
  _created_at TIMESTAMPTZ
) RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, extensions
AS $$
DECLARE
  canonical TEXT;
BEGIN
  canonical := COALESCE(_prev_hash,'')
    || '|' || COALESCE(_purchase_file_id::text,'')
    || '|' || COALESCE(_actor_type,'')
    || '|' || COALESCE(_actor_id::text,'')
    || '|' || COALESCE(_category,'')
    || '|' || COALESCE(_action,'')
    || '|' || COALESCE(_target_type,'')
    || '|' || COALESCE(_target_id::text,'')
    || '|' || COALESCE(_metadata::text,'{}')
    || '|' || COALESCE(to_char(_created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'');
  RETURN encode(extensions.digest(canonical,'sha256'),'hex');
END;
$$;

-- Trigger: fill prev_hash from latest row for same PF, compute row_hash
CREATE OR REPLACE FUNCTION public.tg_purchase_file_audit_events_chain()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _actor_id UUID;
BEGIN
  IF NEW.created_at IS NULL THEN NEW.created_at := now(); END IF;

  -- Find previous hash for this PF (or global if no PF)
  IF NEW.purchase_file_id IS NOT NULL THEN
    SELECT row_hash INTO NEW.prev_hash
    FROM public.purchase_file_audit_events
    WHERE purchase_file_id = NEW.purchase_file_id
    ORDER BY created_at DESC, id DESC
    LIMIT 1;
  ELSE
    SELECT row_hash INTO NEW.prev_hash
    FROM public.purchase_file_audit_events
    WHERE purchase_file_id IS NULL
    ORDER BY created_at DESC, id DESC
    LIMIT 1;
  END IF;

  _actor_id := COALESCE(NEW.actor_finance_user_id, NEW.actor_team_user_id, NEW.actor_client_id);

  NEW.row_hash := public.compute_audit_row_hash(
    NEW.prev_hash,
    NEW.purchase_file_id,
    NEW.actor_type,
    _actor_id,
    NEW.category,
    NEW.action,
    NEW.target_type,
    NEW.target_id,
    NEW.metadata,
    NEW.created_at
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_pf_audit_chain ON public.purchase_file_audit_events;
CREATE TRIGGER tg_pf_audit_chain
BEFORE INSERT ON public.purchase_file_audit_events
FOR EACH ROW EXECUTE FUNCTION public.tg_purchase_file_audit_events_chain();

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.purchase_file_audit_events;
