-- ============================================================
-- Phase 6 — Compliance hardening for partner agreements
-- Audit chain · privacy incidents · retention · termination
-- ============================================================

-- ---------- 1. Partner compliance audit events (hash chained) ----------
CREATE TABLE IF NOT EXISTS public.partner_compliance_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_key text NOT NULL DEFAULT 'global',
  agreement_id uuid REFERENCES public.partner_agreements(id) ON DELETE SET NULL,
  referral_id uuid,
  scope_type text NOT NULL DEFAULT 'system',
  scope_id uuid,
  actor_type text NOT NULL DEFAULT 'team_user',
  actor_id uuid,
  actor_label text,
  severity text NOT NULL DEFAULT 'info',
  category text NOT NULL DEFAULT 'data_change',
  action text NOT NULL,
  target_type text,
  target_id uuid,
  fields_touched text[],
  description text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip_address text,
  user_agent text,
  retention_class text NOT NULL DEFAULT 'standard_7y',
  prev_hash text,
  row_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.partner_compliance_audit_events TO service_role;
ALTER TABLE public.partner_compliance_audit_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "partner_audit_service_role_only"
  ON public.partner_compliance_audit_events FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_pcae_chain ON public.partner_compliance_audit_events(chain_key, created_at, id);
CREATE INDEX IF NOT EXISTS idx_pcae_agreement ON public.partner_compliance_audit_events(agreement_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pcae_scope ON public.partner_compliance_audit_events(scope_type, scope_id, created_at DESC);

-- Hash chain trigger
CREATE OR REPLACE FUNCTION public.compute_partner_audit_row_hash()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prev text;
BEGIN
  NEW.chain_key := COALESCE(NULLIF(NEW.chain_key, ''), COALESCE(NEW.agreement_id::text, 'global'));
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.chain_key, 42));

  SELECT row_hash INTO v_prev
  FROM public.partner_compliance_audit_events
  WHERE chain_key = NEW.chain_key
  ORDER BY created_at DESC, id DESC
  LIMIT 1;

  NEW.prev_hash := v_prev;
  NEW.row_hash := encode(digest(
    COALESCE(v_prev, '') || '|' ||
    COALESCE(NEW.chain_key, '') || '|' ||
    COALESCE(NEW.scope_type, '') || '|' ||
    COALESCE(NEW.scope_id::text, '') || '|' ||
    COALESCE(NEW.actor_type, '') || '|' ||
    COALESCE(NEW.actor_id::text, '') || '|' ||
    COALESCE(NEW.category, '') || '|' ||
    COALESCE(NEW.action, '') || '|' ||
    COALESCE(NEW.target_type, '') || '|' ||
    COALESCE(NEW.target_id::text, '') || '|' ||
    COALESCE(NEW.metadata::text, '{}') || '|' ||
    COALESCE(NEW.created_at::text, '')
  , 'sha256'), 'hex');

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_partner_audit_hash ON public.partner_compliance_audit_events;
CREATE TRIGGER trg_partner_audit_hash
  BEFORE INSERT ON public.partner_compliance_audit_events
  FOR EACH ROW EXECUTE FUNCTION public.compute_partner_audit_row_hash();

-- Append-only enforcement
CREATE OR REPLACE FUNCTION public.partner_audit_append_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'partner_compliance_audit_events is append-only';
END;
$$;

DROP TRIGGER IF EXISTS trg_partner_audit_append_only ON public.partner_compliance_audit_events;
CREATE TRIGGER trg_partner_audit_append_only
  BEFORE UPDATE OR DELETE ON public.partner_compliance_audit_events
  FOR EACH ROW EXECUTE FUNCTION public.partner_audit_append_only();

-- ---------- 2. Privacy incident register ----------
CREATE TABLE IF NOT EXISTS public.partner_privacy_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text NOT NULL UNIQUE DEFAULT ('PI-' || to_char(now(), 'YYYYMMDD') || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)),
  agreement_id uuid REFERENCES public.partner_agreements(id) ON DELETE SET NULL,
  finance_agent_contact_id uuid,
  referral_id uuid,
  direction text,
  incident_type text NOT NULL DEFAULT 'unauthorised_disclosure',
  severity text NOT NULL DEFAULT 'medium',
  status text NOT NULL DEFAULT 'open',
  reported_by_party text NOT NULL DEFAULT 'principal',
  discovered_at timestamptz NOT NULL DEFAULT now(),
  occurred_at timestamptz,
  notification_deadline_at timestamptz,
  assessment_due_at timestamptz,
  title text NOT NULL,
  description text,
  affected_data_categories text[] NOT NULL DEFAULT '{}',
  affected_individual_count integer NOT NULL DEFAULT 0,
  containment_actions text,
  remediation_actions text,
  root_cause text,
  is_notifiable boolean,
  notifiable_assessment_note text,
  notified_partner_at timestamptz,
  notified_individuals_at timestamptz,
  notified_regulator_at timestamptz,
  regulator_reference text,
  closed_at timestamptz,
  closed_by uuid,
  closure_note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.partner_privacy_incidents TO service_role;
ALTER TABLE public.partner_privacy_incidents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "partner_privacy_incidents_service_role_only"
  ON public.partner_privacy_incidents FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_ppi_status ON public.partner_privacy_incidents(status, discovered_at DESC);
CREATE INDEX IF NOT EXISTS idx_ppi_agreement ON public.partner_privacy_incidents(agreement_id);

CREATE OR REPLACE FUNCTION public.partner_privacy_incident_defaults()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  IF NEW.notification_deadline_at IS NULL THEN
    NEW.notification_deadline_at := COALESCE(NEW.discovered_at, now()) + interval '48 hours';
  END IF;
  IF NEW.assessment_due_at IS NULL THEN
    NEW.assessment_due_at := COALESCE(NEW.discovered_at, now()) + interval '30 days';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ppi_defaults ON public.partner_privacy_incidents;
CREATE TRIGGER trg_ppi_defaults
  BEFORE INSERT OR UPDATE ON public.partner_privacy_incidents
  FOR EACH ROW EXECUTE FUNCTION public.partner_privacy_incident_defaults();

-- ---------- 3. Retention + termination columns on agreements ----------
ALTER TABLE public.partner_agreements
  ADD COLUMN IF NOT EXISTS retention_until date,
  ADD COLUMN IF NOT EXISTS retention_hold boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS retention_hold_reason text,
  ADD COLUMN IF NOT EXISTS retention_hold_set_at timestamptz,
  ADD COLUMN IF NOT EXISTS destroyed_at timestamptz,
  ADD COLUMN IF NOT EXISTS destruction_note text,
  ADD COLUMN IF NOT EXISTS terminated_by uuid,
  ADD COLUMN IF NOT EXISTS termination_notice_given_at timestamptz,
  ADD COLUMN IF NOT EXISTS termination_effective_date date,
  ADD COLUMN IF NOT EXISTS post_termination_cutoff_date date,
  ADD COLUMN IF NOT EXISTS accrued_entitlements_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS accrued_entitlements_resolved_at timestamptz;

-- Keep retention_until in sync with the retention years + lifecycle anchor
CREATE OR REPLACE FUNCTION public.partner_agreement_sync_retention()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_anchor date;
  v_years integer;
BEGIN
  v_years := COALESCE(NEW.records_retention_years, 7);
  v_anchor := COALESCE(
    NEW.termination_effective_date,
    NEW.terminated_at::date,
    NEW.termination_date,
    NEW.effective_date,
    NEW.created_at::date,
    CURRENT_DATE
  );
  NEW.retention_until := v_anchor + (v_years || ' years')::interval;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_partner_agreement_retention ON public.partner_agreements;
CREATE TRIGGER trg_partner_agreement_retention
  BEFORE INSERT OR UPDATE ON public.partner_agreements
  FOR EACH ROW EXECUTE FUNCTION public.partner_agreement_sync_retention();

UPDATE public.partner_agreements SET updated_at = updated_at;

-- ---------- 4. Retention register view ----------
CREATE OR REPLACE VIEW public.partner_agreement_retention_register AS
SELECT
  a.id,
  a.direction,
  a.status,
  a.version,
  a.partner_legal_name,
  a.partner_trading_name,
  a.finance_agent_contact_id,
  a.effective_date,
  a.termination_effective_date,
  a.terminated_at,
  a.records_retention_years,
  a.retention_until,
  a.retention_hold,
  a.retention_hold_reason,
  a.destroyed_at,
  CASE
    WHEN a.destroyed_at IS NOT NULL THEN 'destroyed'
    WHEN a.retention_hold THEN 'legal_hold'
    WHEN a.retention_until IS NULL THEN 'unknown'
    WHEN a.retention_until <= CURRENT_DATE THEN 'eligible_for_destruction'
    WHEN a.retention_until <= CURRENT_DATE + 180 THEN 'expiring_soon'
    ELSE 'retained'
  END AS retention_state,
  (a.retention_until - CURRENT_DATE) AS days_until_retention_end
FROM public.partner_agreements a;

GRANT SELECT ON public.partner_agreement_retention_register TO service_role;

-- ---------- 5. Accrued entitlement resolver ----------
CREATE OR REPLACE FUNCTION public.partner_accrued_entitlements(_agreement_id uuid)
RETURNS TABLE (
  pending_commission_count integer,
  pending_commission_total numeric,
  unpaid_statement_count integer,
  unpaid_statement_total numeric,
  open_clawback_count integer,
  open_clawback_total numeric,
  open_dispute_count integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contact uuid;
BEGIN
  SELECT finance_agent_contact_id INTO v_contact
  FROM public.partner_agreements WHERE id = _agreement_id;

  RETURN QUERY
  SELECT
    (SELECT COUNT(*)::integer FROM public.finance_partner_commissions c
      WHERE c.finance_contact_id = v_contact AND c.status NOT IN ('paid', 'cancelled', 'clawed_back')),
    (SELECT COALESCE(SUM(c.net_amount), 0) FROM public.finance_partner_commissions c
      WHERE c.finance_contact_id = v_contact AND c.status NOT IN ('paid', 'cancelled', 'clawed_back')),
    (SELECT COUNT(*)::integer FROM public.finance_partner_statements s
      WHERE s.finance_contact_id = v_contact AND s.status <> 'paid'),
    (SELECT COALESCE(SUM(s.total_net), 0) FROM public.finance_partner_statements s
      WHERE s.finance_contact_id = v_contact AND s.status <> 'paid'),
    (SELECT COUNT(*)::integer FROM public.finance_partner_clawbacks cb
      WHERE cb.finance_contact_id = v_contact AND cb.status NOT IN ('settled', 'waived', 'cancelled')),
    (SELECT COALESCE(SUM(cb.clawback_amount - COALESCE(cb.amount_recovered, 0)), 0) FROM public.finance_partner_clawbacks cb
      WHERE cb.finance_contact_id = v_contact AND cb.status NOT IN ('settled', 'waived', 'cancelled')),
    (SELECT COUNT(*)::integer FROM public.finance_partner_statement_disputes d
      JOIN public.finance_partner_statements s2 ON s2.id = d.statement_id
      WHERE s2.finance_contact_id = v_contact AND d.status IN ('open', 'under_review'));
END;
$$;

REVOKE ALL ON FUNCTION public.partner_accrued_entitlements(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.partner_accrued_entitlements(uuid) TO service_role;