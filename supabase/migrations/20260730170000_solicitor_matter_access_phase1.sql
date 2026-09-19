-- Solicitor cross-portal programme Phase 1: explicit matter access and deny-capable policy.
-- Expansion only: legacy client assignments remain for rollback/reconciliation.

CREATE OR REPLACE FUNCTION public.solicitor_tri_state_permissions_valid(value jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT jsonb_typeof(value) = 'object'
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_each(value) area
      WHERE jsonb_typeof(area.value) <> 'object'
         OR EXISTS (
           SELECT 1 FROM jsonb_each_text(area.value) decision
           WHERE decision.key NOT IN ('view','edit','delete')
              OR decision.value NOT IN ('inherit','allow','deny')
         )
    );
$$;
REVOKE ALL ON FUNCTION public.solicitor_tri_state_permissions_valid(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.solicitor_tri_state_permissions_valid(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.solicitor_legacy_permissions_to_tri_state(value jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE area record; decision record; converted jsonb := '{}'::jsonb; area_value jsonb;
BEGIN
  IF value IS NULL OR jsonb_typeof(value) <> 'object' THEN RETURN converted; END IF;
  FOR area IN SELECT * FROM jsonb_each(value) LOOP
    IF jsonb_typeof(area.value) <> 'object' THEN CONTINUE; END IF;
    area_value := '{}'::jsonb;
    FOR decision IN SELECT * FROM jsonb_each(area.value) LOOP
      IF decision.key IN ('view','edit','delete') THEN
        area_value := jsonb_set(area_value, ARRAY[decision.key],
          to_jsonb(CASE WHEN decision.value = 'true'::jsonb THEN 'allow' ELSE 'deny' END));
      END IF;
    END LOOP;
    converted := jsonb_set(converted, ARRAY[area.key], area_value);
  END LOOP;
  RETURN converted;
END;
$$;
REVOKE ALL ON FUNCTION public.solicitor_legacy_permissions_to_tri_state(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.solicitor_legacy_permissions_to_tri_state(jsonb) TO service_role;

CREATE TABLE IF NOT EXISTS public.solicitor_matter_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  solicitor_user_id uuid NOT NULL REFERENCES public.solicitor_portal_users(id) ON DELETE CASCADE,
  legal_matter_id uuid NOT NULL REFERENCES public.legal_matters(id) ON DELETE CASCADE,
  firm_id uuid NOT NULL REFERENCES public.solicitor_firms(id) ON DELETE CASCADE,
  access_role text NOT NULL DEFAULT 'team_member'
    CHECK (access_role IN ('responsible','team_member','supervisor','read_only')),
  permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz,
  granted_by uuid,
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by uuid,
  revocation_reason text,
  source_assignment_id uuid REFERENCES public.solicitor_portal_client_assignments(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT solicitor_matter_access_window_valid CHECK (valid_until IS NULL OR valid_until > valid_from),
  CONSTRAINT solicitor_matter_access_permissions_valid CHECK (public.solicitor_tri_state_permissions_valid(permissions)),
  UNIQUE (solicitor_user_id, legal_matter_id)
);

CREATE INDEX IF NOT EXISTS solicitor_matter_access_user_matter_idx
  ON public.solicitor_matter_access (solicitor_user_id, legal_matter_id);
CREATE INDEX IF NOT EXISTS solicitor_matter_access_matter_revoked_idx
  ON public.solicitor_matter_access (legal_matter_id, revoked_at);
CREATE INDEX IF NOT EXISTS solicitor_matter_access_firm_matter_idx
  ON public.solicitor_matter_access (firm_id, legal_matter_id);

GRANT ALL ON public.solicitor_matter_access TO service_role;
REVOKE ALL ON public.solicitor_matter_access FROM anon, authenticated;
ALTER TABLE public.solicitor_matter_access ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS solicitor_matter_access_service_role_only ON public.solicitor_matter_access;
CREATE POLICY solicitor_matter_access_service_role_only ON public.solicitor_matter_access
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.enforce_solicitor_matter_access_firm()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE user_firm uuid; matter_firm uuid;
BEGIN
  SELECT firm_id INTO user_firm FROM public.solicitor_portal_users WHERE id = NEW.solicitor_user_id;
  SELECT firm_id INTO matter_firm FROM public.legal_matters WHERE id = NEW.legal_matter_id;
  IF user_firm IS NULL OR matter_firm IS NULL OR NEW.firm_id <> user_firm OR NEW.firm_id <> matter_firm THEN
    RAISE EXCEPTION 'solicitor matter access requires one exact non-null firm' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_solicitor_matter_access_firm() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enforce_solicitor_matter_access_firm() TO service_role;
DROP TRIGGER IF EXISTS trg_enforce_solicitor_matter_access_firm ON public.solicitor_matter_access;
CREATE TRIGGER trg_enforce_solicitor_matter_access_firm
  BEFORE INSERT OR UPDATE OF solicitor_user_id, legal_matter_id, firm_id
  ON public.solicitor_matter_access FOR EACH ROW
  EXECUTE FUNCTION public.enforce_solicitor_matter_access_firm();

CREATE OR REPLACE FUNCTION public.prevent_solicitor_matter_access_firm_drift()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.firm_id IS NOT DISTINCT FROM OLD.firm_id THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'legal_matters' AND EXISTS (
    SELECT 1 FROM public.solicitor_matter_access
    WHERE legal_matter_id = OLD.id AND revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'revoke active solicitor matter access before changing matter firm' USING ERRCODE = '23514';
  END IF;
  IF TG_TABLE_NAME = 'solicitor_portal_users' AND EXISTS (
    SELECT 1 FROM public.solicitor_matter_access
    WHERE solicitor_user_id = OLD.id AND revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'revoke active solicitor matter access before changing user firm' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.prevent_solicitor_matter_access_firm_drift() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prevent_solicitor_matter_access_firm_drift() TO service_role;
DROP TRIGGER IF EXISTS trg_prevent_legal_matter_access_firm_drift ON public.legal_matters;
CREATE TRIGGER trg_prevent_legal_matter_access_firm_drift
  BEFORE UPDATE OF firm_id ON public.legal_matters FOR EACH ROW
  EXECUTE FUNCTION public.prevent_solicitor_matter_access_firm_drift();
DROP TRIGGER IF EXISTS trg_prevent_solicitor_user_access_firm_drift ON public.solicitor_portal_users;
CREATE TRIGGER trg_prevent_solicitor_user_access_firm_drift
  BEFORE UPDATE OF firm_id ON public.solicitor_portal_users FOR EACH ROW
  EXECUTE FUNCTION public.prevent_solicitor_matter_access_firm_drift();

DROP TRIGGER IF EXISTS trg_solicitor_matter_access_updated_at ON public.solicitor_matter_access;
CREATE TRIGGER trg_solicitor_matter_access_updated_at
  BEFORE UPDATE ON public.solicitor_matter_access
  FOR EACH ROW EXECUTE FUNCTION public.solicitor_portal_touch_updated_at();

CREATE TABLE IF NOT EXISTS public.solicitor_matter_access_migration_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_assignment_id uuid REFERENCES public.solicitor_portal_client_assignments(id) ON DELETE SET NULL,
  solicitor_user_id uuid,
  client_id uuid,
  legal_matter_id uuid,
  exception_code text NOT NULL CHECK (exception_code IN ('null_matter_firm','firm_mismatch','missing_user')),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolved_at timestamptz,
  resolved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_assignment_id, legal_matter_id, exception_code)
);
GRANT ALL ON public.solicitor_matter_access_migration_exceptions TO service_role;
REVOKE ALL ON public.solicitor_matter_access_migration_exceptions FROM anon, authenticated;
ALTER TABLE public.solicitor_matter_access_migration_exceptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS solicitor_matter_access_exceptions_service_role_only ON public.solicitor_matter_access_migration_exceptions;
CREATE POLICY solicitor_matter_access_exceptions_service_role_only
  ON public.solicitor_matter_access_migration_exceptions FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Preserve currently reachable exact-firm matters. This deliberately expands one
-- legacy client assignment into only the matters that exist at migration time.
INSERT INTO public.solicitor_matter_access (
  solicitor_user_id, legal_matter_id, firm_id, access_role, permissions,
  valid_from, granted_by, source_assignment_id
)
SELECT a.solicitor_user_id, m.id, m.firm_id,
       CASE WHEN m.assigned_solicitor_user_id = a.solicitor_user_id THEN 'responsible' ELSE 'team_member' END,
       public.solicitor_legacy_permissions_to_tri_state(a.permissions), a.assigned_at, a.assigned_by, a.id
FROM public.solicitor_portal_client_assignments a
JOIN public.solicitor_portal_users u ON u.id = a.solicitor_user_id
JOIN public.legal_matters m ON m.client_id = a.client_id
WHERE m.firm_id IS NOT NULL AND m.firm_id = u.firm_id
ON CONFLICT (solicitor_user_id, legal_matter_id) DO NOTHING;

-- Never auto-grant null-firm or cross-firm rows. Record them for human resolution.
INSERT INTO public.solicitor_matter_access_migration_exceptions (
  source_assignment_id, solicitor_user_id, client_id, legal_matter_id, exception_code, details
)
SELECT a.id, a.solicitor_user_id, a.client_id, m.id,
       CASE WHEN m.firm_id IS NULL THEN 'null_matter_firm' ELSE 'firm_mismatch' END,
       jsonb_build_object('matter_firm_id', m.firm_id, 'user_firm_id', u.firm_id)
FROM public.solicitor_portal_client_assignments a
JOIN public.solicitor_portal_users u ON u.id = a.solicitor_user_id
JOIN public.legal_matters m ON m.client_id = a.client_id
WHERE m.firm_id IS NULL OR m.firm_id <> u.firm_id
ON CONFLICT (source_assignment_id, legal_matter_id, exception_code) DO NOTHING;

COMMENT ON TABLE public.solicitor_matter_access IS
  'Explicit Solicitor Portal access grants. Client identity is never an authorization boundary.';
COMMENT ON COLUMN public.solicitor_matter_access.permissions IS
  'Tri-state matrix: each action is inherit, allow, or deny; explicit matter values override baseline.';
