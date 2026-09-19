
-- =========================================================
-- Solicitor Portal Phase 8: Compliance, audit & hardening
-- =========================================================

-- 1. Hash function for the legal audit chain -------------------------------
CREATE OR REPLACE FUNCTION public.compute_legal_audit_row_hash(
  _prev_hash text,
  _legal_matter_id uuid,
  _actor_type text,
  _actor_id uuid,
  _category text,
  _action text,
  _target_type text,
  _target_id uuid,
  _metadata jsonb,
  _created_at timestamptz
) RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public', 'extensions'
AS $$
DECLARE canonical TEXT;
BEGIN
  canonical := COALESCE(_prev_hash,'')
    || '|' || COALESCE(_legal_matter_id::text,'')
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

-- 2. Audit events ----------------------------------------------------------
CREATE TABLE public.legal_matter_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_matter_id uuid REFERENCES public.legal_matters(id) ON DELETE CASCADE,
  client_id uuid,
  firm_id uuid,
  actor_type text NOT NULL DEFAULT 'solicitor_user',
  actor_solicitor_user_id uuid,
  actor_staff_user_id uuid,
  actor_client_portal_user_id uuid,
  severity text NOT NULL DEFAULT 'info',
  category text NOT NULL,
  action text NOT NULL,
  target_type text,
  target_id uuid,
  fields_accessed text[],
  description text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip_address text,
  user_agent text,
  retention_class text NOT NULL DEFAULT 'standard_7y',
  prev_hash text,
  row_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_lmae_matter_created ON public.legal_matter_audit_events(legal_matter_id, created_at DESC);
CREATE INDEX idx_lmae_client ON public.legal_matter_audit_events(client_id);
CREATE INDEX idx_lmae_category ON public.legal_matter_audit_events(category);

GRANT ALL ON public.legal_matter_audit_events TO service_role;
ALTER TABLE public.legal_matter_audit_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "legal_audit_service_role_only"
  ON public.legal_matter_audit_events FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION public.legal_audit_chain_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE last_hash TEXT;
BEGIN
  NEW.created_at := COALESCE(NEW.created_at, now());
  SELECT row_hash INTO last_hash
  FROM public.legal_matter_audit_events
  WHERE legal_matter_id IS NOT DISTINCT FROM NEW.legal_matter_id
  ORDER BY created_at DESC, id DESC
  LIMIT 1;

  NEW.prev_hash := last_hash;
  NEW.row_hash := public.compute_legal_audit_row_hash(
    last_hash,
    NEW.legal_matter_id,
    NEW.actor_type,
    COALESCE(NEW.actor_solicitor_user_id, NEW.actor_staff_user_id, NEW.actor_client_portal_user_id),
    NEW.category,
    NEW.action,
    NEW.target_type,
    NEW.target_id,
    COALESCE(NEW.metadata,'{}'::jsonb),
    NEW.created_at
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_legal_audit_chain
  BEFORE INSERT ON public.legal_matter_audit_events
  FOR EACH ROW EXECUTE FUNCTION public.legal_audit_chain_before_insert();

-- Immutability: audit rows may never be updated or deleted.
CREATE OR REPLACE FUNCTION public.legal_audit_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  RAISE EXCEPTION 'legal_matter_audit_events is append-only';
END;
$$;

CREATE TRIGGER trg_legal_audit_immutable
  BEFORE UPDATE OR DELETE ON public.legal_matter_audit_events
  FOR EACH ROW EXECUTE FUNCTION public.legal_audit_immutable();

-- 3. Conflict checks -------------------------------------------------------
CREATE TABLE public.legal_conflict_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_matter_id uuid NOT NULL REFERENCES public.legal_matters(id) ON DELETE CASCADE,
  firm_id uuid,
  client_id uuid,
  searched_terms text[] NOT NULL DEFAULT '{}',
  outcome text NOT NULL DEFAULT 'pending',
  matches jsonb NOT NULL DEFAULT '[]'::jsonb,
  match_count integer NOT NULL DEFAULT 0,
  notes text,
  cleared_at timestamptz,
  cleared_by_type text,
  cleared_by_solicitor_user_id uuid,
  cleared_by_staff_user_id uuid,
  created_by_type text NOT NULL DEFAULT 'solicitor_user',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_lcc_matter ON public.legal_conflict_checks(legal_matter_id, created_at DESC);

GRANT ALL ON public.legal_conflict_checks TO service_role;
ALTER TABLE public.legal_conflict_checks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "legal_conflict_service_role_only"
  ON public.legal_conflict_checks FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE TRIGGER trg_lcc_updated_at
  BEFORE UPDATE ON public.legal_conflict_checks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4. Compliance exports ----------------------------------------------------
CREATE TABLE public.legal_compliance_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_matter_id uuid NOT NULL REFERENCES public.legal_matters(id) ON DELETE CASCADE,
  firm_id uuid,
  client_id uuid,
  export_scope text NOT NULL DEFAULT 'full',
  format text NOT NULL DEFAULT 'json',
  section_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  chain_verified boolean,
  chain_broken_at uuid,
  requested_by_type text NOT NULL DEFAULT 'solicitor_user',
  requested_by_solicitor_user_id uuid,
  requested_by_staff_user_id uuid,
  ip_address text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_lce_matter ON public.legal_compliance_exports(legal_matter_id, created_at DESC);

GRANT ALL ON public.legal_compliance_exports TO service_role;
ALTER TABLE public.legal_compliance_exports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "legal_compliance_exports_service_role_only"
  ON public.legal_compliance_exports FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- 5. Closure & retention on matters ---------------------------------------
ALTER TABLE public.legal_matters
  ADD COLUMN IF NOT EXISTS closure_status text NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS closure_reason text,
  ADD COLUMN IF NOT EXISTS closure_checklist jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS closed_by_type text,
  ADD COLUMN IF NOT EXISTS closed_by_solicitor_user_id uuid,
  ADD COLUMN IF NOT EXISTS retention_class text NOT NULL DEFAULT 'standard_7y',
  ADD COLUMN IF NOT EXISTS retention_until date,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS conflict_check_status text NOT NULL DEFAULT 'not_run',
  ADD COLUMN IF NOT EXISTS conflict_checked_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_legal_matters_closure ON public.legal_matters(closure_status);

-- 6. Realtime --------------------------------------------------------------
ALTER PUBLICATION supabase_realtime ADD TABLE public.legal_matter_audit_events;
ALTER PUBLICATION supabase_realtime ADD TABLE public.legal_conflict_checks;
