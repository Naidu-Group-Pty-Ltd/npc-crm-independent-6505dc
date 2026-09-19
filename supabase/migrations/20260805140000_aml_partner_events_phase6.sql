-- Reliable partner compliance events, invalidation and refresh — Phase 6 of
-- the AML/CTF partner/reliance domain.
--
-- ── COLLISION ANALYSIS (§6.1 — recorded before any new schema) ────────────
--
-- The repository already contains ONE canonical transactional outbox:
--
--   public.integration_outbox            (20260730220000) — idempotency_key
--                                        UNIQUE, correlation_id, available_at
--                                        /processed_at/locked_*/attempts,
--                                        partial pending index
--   public.integration_delivery_attempts per-consumer attempt ledger with
--                                        UNIQUE(outbox_id,consumer_name,
--                                        attempt_number)
--   public.integration_dead_letters      terminal failures, replayable via
--                                        public.replay_integration_dead_letter
--   public.projection_checkpoints        per-consumer checkpoints
--   RPCs: enqueue_integration_event (ON CONFLICT no-op → duplicate-safe),
--         claim_integration_outbox (FOR UPDATE SKIP LOCKED, lock lease),
--         replay_integration_dead_letter
--   Worker: supabase/functions/cross-portal-outbox-worker (invokable POST,
--         x-worker-secret, exponential backoff 2**attempts capped 3600s,
--         terminal at attempts>=10, evidence never deleted after success).
--
-- DECISION: aml.integration_outbox is NOT created. The platform outbox is
-- tenant-safe for this repository (single-tenant 'default'; every AML event
-- row carries only identifiers and controlled codes) and already satisfies
-- atomicity (same-transaction insert), idempotency (UNIQUE key), retry,
-- dead-lettering and replay. Phase 6 EXTENDS it:
--
--   * additive NULLABLE columns on public.integration_outbox for the AML
--     envelope (partner_org_id, partner_case_link_id, causation_id,
--     destination_class, payload_classification). Plain uuids, no FKs — the
--     outbox is evidence and must never block an aml cascade delete, and the
--     platform table stays decoupled from the aml schema;
--   * aml.partner_event_catalogue — the CLOSED event-type catalogue (§6.4).
--     Unknown event types cannot be enqueued;
--   * aml.enqueue_partner_event — the single choke point. Feature-flag
--     gated (off = zero writes), catalogue-validated, restricted-key
--     tripwire on the payload, ON CONFLICT duplicate-safe;
--   * AFTER triggers on the aml domain tables so event creation is ATOMIC
--     with the originating business transaction by construction — no code
--     path can change domain state without the event, and a rolled-back
--     transaction leaves neither;
--   * aml.partner_refresh_obligations (§6.6) and aml.partner_notifications
--     (the worker's idempotent partner-safe delivery destination);
--   * refresh-required columns on compliance_attestations / reliance_grants
--     / independent_assessments and the transactional material-change RPC
--     aml.apply_partner_material_change (§6.5).
--
-- The worker consumer NEVER writes authoritative AML state (grants,
-- attestations, links, gate) — a duplicate, replayed or out-of-order event
-- structurally cannot reopen revoked access or restore superseded content.
--
-- Staged enablement (documented, §6.9): flag OFF (default) = the enqueue
-- choke point returns NULL, no outbox rows are written, the material-change
-- op answers 409, behaviour is byte-identical to Phase 5. Flag ON without a
-- scheduled worker = events accumulate visibly in the ops card (pending
-- count grows — an honest backlog, not a false promise). Flag ON with the
-- worker invoked on a schedule = delivery. Worker deployment/scheduling
-- ownership is an operator action recorded in
-- docs/aml/partner-events-and-refresh.md; nothing here claims it happened.
--
-- Additive only.
--
-- ROLLBACK:
--   DROP TRIGGER IF EXISTS trg_aml_emit_partner_link_events ON aml.partner_case_links;
--   DROP TRIGGER IF EXISTS trg_aml_emit_attestation_events ON aml.compliance_attestations;
--   DROP TRIGGER IF EXISTS trg_aml_emit_grant_events ON aml.reliance_grants;
--   DROP TRIGGER IF EXISTS trg_aml_emit_records_request_events ON aml.partner_records_requests;
--   DROP TRIGGER IF EXISTS trg_aml_emit_evidence_delivery_events ON aml.partner_evidence_deliveries;
--   DROP TRIGGER IF EXISTS trg_aml_emit_determination_events ON aml.independent_assessments;
--   DROP TRIGGER IF EXISTS trg_aml_emit_retention_trigger_events ON aml.retention_triggers;
--   DROP TRIGGER IF EXISTS trg_aml_emit_legal_hold_events ON aml.legal_holds;
--   DROP TRIGGER IF EXISTS trg_aml_refresh_obligations_updated_at ON aml.partner_refresh_obligations;
--   DROP FUNCTION IF EXISTS aml.emit_partner_link_events();
--   DROP FUNCTION IF EXISTS aml.emit_attestation_events();
--   DROP FUNCTION IF EXISTS aml.emit_grant_events();
--   DROP FUNCTION IF EXISTS aml.emit_records_request_events();
--   DROP FUNCTION IF EXISTS aml.emit_evidence_delivery_events();
--   DROP FUNCTION IF EXISTS aml.emit_determination_events();
--   DROP FUNCTION IF EXISTS aml.emit_retention_trigger_events();
--   DROP FUNCTION IF EXISTS aml.emit_legal_hold_events();
--   DROP FUNCTION IF EXISTS aml.apply_partner_material_change(uuid, uuid, text, text[], text, text, uuid, integer, uuid);
--   DROP FUNCTION IF EXISTS aml.enqueue_partner_event(text, text, uuid, integer, jsonb, text, uuid, uuid, uuid, uuid);
--   DROP FUNCTION IF EXISTS aml.assert_partner_event_payload_safe(jsonb, text);
--   DROP FUNCTION IF EXISTS aml.partner_events_enabled();
--   DROP TABLE IF EXISTS aml.partner_notifications;
--   DROP TABLE IF EXISTS aml.partner_refresh_obligations;
--   DROP TABLE IF EXISTS aml.partner_event_catalogue;
--   ALTER TABLE aml.independent_assessments DROP COLUMN IF EXISTS refresh_required_at;
--   ALTER TABLE aml.reliance_grants
--     DROP COLUMN IF EXISTS refresh_reason_code,
--     DROP COLUMN IF EXISTS refresh_required_at;
--   ALTER TABLE aml.compliance_attestations
--     DROP COLUMN IF EXISTS refresh_reason_code,
--     DROP COLUMN IF EXISTS refresh_required_at;
--   DROP INDEX IF EXISTS public.idx_integration_outbox_aml_pending;
--   ALTER TABLE public.integration_outbox
--     DROP COLUMN IF EXISTS payload_classification,
--     DROP COLUMN IF EXISTS destination_class,
--     DROP COLUMN IF EXISTS causation_id,
--     DROP COLUMN IF EXISTS partner_case_link_id,
--     DROP COLUMN IF EXISTS partner_org_id;
--   DELETE FROM public.feature_flags WHERE key = 'aml_partner_event_outbox';

-- ── 1. AML envelope on the canonical outbox (nullable, no FKs) ────────────

ALTER TABLE public.integration_outbox
  ADD COLUMN IF NOT EXISTS partner_org_id uuid,
  ADD COLUMN IF NOT EXISTS partner_case_link_id uuid,
  ADD COLUMN IF NOT EXISTS causation_id uuid,
  ADD COLUMN IF NOT EXISTS destination_class text
    CHECK (destination_class IS NULL OR destination_class IN ('ops', 'partner', 'both')),
  ADD COLUMN IF NOT EXISTS payload_classification text
    CHECK (payload_classification IS NULL OR payload_classification = 'partner_safe');

CREATE INDEX IF NOT EXISTS idx_integration_outbox_aml_pending
  ON public.integration_outbox (occurred_at)
  WHERE processed_at IS NULL AND event_type LIKE 'aml.%';

-- ── 2. The closed event catalogue (§6.4) ──────────────────────────────────
-- Deliberately NOT emitted: anything naming potential matches, screening
-- content, investigation detail or suspicious-matter reporting.

CREATE TABLE IF NOT EXISTS aml.partner_event_catalogue (
  event_type text PRIMARY KEY CHECK (event_type LIKE 'aml.%'),
  aggregate_type text NOT NULL,
  -- ops    = Command Center visibility only, never a partner notification
  -- partner/both = the worker MAY write a partner-safe notification row
  destination_class text NOT NULL CHECK (destination_class IN ('ops', 'partner', 'both')),
  emitted_by text NOT NULL CHECK (emitted_by IN ('trigger', 'worker_sweep', 'phase7')),
  description text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO aml.partner_event_catalogue (event_type, aggregate_type, destination_class, emitted_by, description) VALUES
  ('aml.partner_case_link.created',            'partner_case_link',      'both',    'trigger',      'A partner organisation was linked to a case.'),
  ('aml.partner_case_link.suspended',          'partner_case_link',      'both',    'trigger',      'A partner-case link was suspended.'),
  ('aml.partner_case_link.ended',              'partner_case_link',      'both',    'trigger',      'A partner-case link was ended.'),
  ('aml.attestation.issued',                   'compliance_attestation', 'both',    'trigger',      'A compliance attestation version was issued.'),
  ('aml.attestation.superseded',               'compliance_attestation', 'both',    'trigger',      'An attestation version was superseded by a newer one.'),
  ('aml.attestation.refresh_required',         'compliance_attestation', 'both',    'trigger',      'A material change flagged the current attestation for refresh.'),
  ('aml.partner_access.created',               'reliance_grant',         'both',    'trigger',      'Reliance access was granted to a partner organisation.'),
  ('aml.partner_access.revoked',               'reliance_grant',         'both',    'trigger',      'Reliance access was revoked.'),
  ('aml.partner_access.expired',               'reliance_grant',         'both',    'worker_sweep', 'Reliance access passed its expiry.'),
  ('aml.records_request.submitted',            'partner_records_request','ops',     'trigger',      'A partner submitted a controlled records request.'),
  ('aml.records_request.reviewed',             'partner_records_request','both',    'trigger',      'The origin reviewed a partner records request.'),
  ('aml.evidence_delivery.created',            'partner_evidence_delivery','both',  'trigger',      'An evidence delivery was recorded for an approved request.'),
  ('aml.evidence_delivery.revoked',            'partner_evidence_delivery','both',  'trigger',      'A recorded evidence delivery was revoked.'),
  ('aml.partner_determination.recorded',       'independent_assessment', 'ops',     'trigger',      'A partner recorded its own compliance determination.'),
  ('aml.partner_determination.refresh_required','independent_assessment','both',    'trigger',      'A material change flagged a partner determination for refresh.'),
  ('aml.arrangement.review_due',               'reliance_agreement',     'ops',     'worker_sweep', 'A CDD arrangement review falls due within the notice window.'),
  ('aml.arrangement.overdue',                  'reliance_agreement',     'ops',     'worker_sweep', 'A CDD arrangement review is overdue.'),
  ('aml.retention_trigger.recorded',           'retention_trigger',      'ops',     'trigger',      'A retention trigger was recorded for a record.'),
  ('aml.legal_hold.added',                     'legal_hold',             'ops',     'trigger',      'A legal hold was imposed. Never partner-visible.'),
  ('aml.legal_hold.released',                  'legal_hold',             'ops',     'trigger',      'A legal hold was released. Never partner-visible.'),
  ('aml.disposal.approved',                    'retention_scan',         'ops',     'phase7',       'A disposal run was approved (emitter arrives with Phase 7).'),
  ('aml.disposal.executed',                    'retention_scan',         'ops',     'phase7',       'A disposal run executed (emitter arrives with Phase 7).'),
  ('aml.disposal.failed',                      'retention_scan',         'ops',     'phase7',       'A disposal action failed (emitter arrives with Phase 7).')
ON CONFLICT (event_type) DO NOTHING;

GRANT ALL ON aml.partner_event_catalogue TO service_role;
ALTER TABLE aml.partner_event_catalogue ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "aml_partner_event_catalogue_service_only"
    ON aml.partner_event_catalogue FOR ALL TO service_role
    USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 3. Flag gate + payload tripwire + the enqueue choke point ─────────────

-- Tolerates every feature-flag value shape used in this repo
-- (true / "true" / {"enabled": true}), like flagEnabled() in aml-reliance.
CREATE OR REPLACE FUNCTION aml.partner_events_enabled()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((
    SELECT value = 'true'::jsonb
        OR value = '"true"'::jsonb
        OR (jsonb_typeof(value) = 'object' AND value->>'enabled' = 'true')
    FROM public.feature_flags WHERE key = 'aml_partner_event_outbox'
  ), false)
$$;

-- SQL mirror of the restricted-key tripwire in _shared/aml/attestationV2.ts,
-- widened with credential vocabulary (§6.3: never store tokens or secrets in
-- event/error records). Scans keys at every nesting depth.
CREATE OR REPLACE FUNCTION aml.assert_partner_event_payload_safe(_payload jsonb, _path text DEFAULT 'payload')
RETURNS void LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  k text; v jsonb;
  restricted constant text :=
    '(risk_rating|risk_score|risk_tier|match|adverse|reviewer|mlro|analyst|edd|suspicious|smr\y|report_status|discrepan|biometric|storage_path|bucket|signed_url|internal_note|decision_notes|access_token|refresh_token|secret|password|api_key|authorization)';
BEGIN
  IF _payload IS NULL THEN RETURN; END IF;
  IF jsonb_typeof(_payload) = 'object' THEN
    FOR k, v IN SELECT key, value FROM jsonb_each(_payload) LOOP
      IF k ~* restricted THEN
        RAISE EXCEPTION 'restricted key "%" in partner event payload at %', k, _path;
      END IF;
      PERFORM aml.assert_partner_event_payload_safe(v, _path || '.' || k);
    END LOOP;
  ELSIF jsonb_typeof(_payload) = 'array' THEN
    FOR v IN SELECT value FROM jsonb_array_elements(_payload) LOOP
      PERFORM aml.assert_partner_event_payload_safe(v, _path || '[]');
    END LOOP;
  END IF;
END $$;

-- The single choke point. Everything AML that enters the platform outbox
-- passes through here: flag-gated (off = NULL, no write), catalogue-
-- validated (unknown types cannot exist), tripwire-scanned, duplicate-safe
-- (ON CONFLICT no-op returns the existing event id — a retried transaction
-- or a re-fired trigger cannot create a second event).
CREATE OR REPLACE FUNCTION aml.enqueue_partner_event(
  _event_type text,
  _aggregate_type text,
  _aggregate_id uuid,
  _aggregate_version integer,
  _payload jsonb,
  _idempotency_key text,
  _partner_org_id uuid DEFAULT NULL,
  _partner_case_link_id uuid DEFAULT NULL,
  _correlation_id uuid DEFAULT NULL,
  _causation_id uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = aml, public AS $$
DECLARE cat record; event_id uuid; safe_payload jsonb;
BEGIN
  IF NOT aml.partner_events_enabled() THEN RETURN NULL; END IF;
  SELECT * INTO cat FROM aml.partner_event_catalogue WHERE event_type = _event_type;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown partner event type % — the catalogue is closed', _event_type;
  END IF;
  safe_payload := COALESCE(_payload, '{}'::jsonb)
    || jsonb_build_object('aggregate_version', COALESCE(_aggregate_version, 1));
  PERFORM aml.assert_partner_event_payload_safe(safe_payload, _event_type);
  INSERT INTO public.integration_outbox
    (aggregate_type, aggregate_id, event_type, event_version, payload, idempotency_key,
     correlation_id, partner_org_id, partner_case_link_id, causation_id,
     destination_class, payload_classification)
  VALUES
    (_aggregate_type, _aggregate_id, _event_type, 1, safe_payload, _idempotency_key,
     COALESCE(_correlation_id, gen_random_uuid()), _partner_org_id, _partner_case_link_id,
     _causation_id, cat.destination_class, 'partner_safe')
  ON CONFLICT (idempotency_key) DO UPDATE SET idempotency_key = EXCLUDED.idempotency_key
  RETURNING id INTO event_id;
  RETURN event_id;
END $$;

REVOKE ALL ON FUNCTION aml.partner_events_enabled(),
  aml.assert_partner_event_payload_safe(jsonb, text),
  aml.enqueue_partner_event(text, text, uuid, integer, jsonb, text, uuid, uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION aml.partner_events_enabled(),
  aml.assert_partner_event_payload_safe(jsonb, text),
  aml.enqueue_partner_event(text, text, uuid, integer, jsonb, text, uuid, uuid, uuid, uuid)
  TO service_role;

-- ── 4. Refresh-required state (additive columns) ──────────────────────────
-- Supersession already exists (Phase 3). Refresh-required is the softer
-- state a material change sets: the content stops being served (the
-- workspace/redeem readers treat non-current as undisclosable) while the
-- MLRO decides whether to re-issue. History is never edited.

ALTER TABLE aml.compliance_attestations
  ADD COLUMN IF NOT EXISTS refresh_required_at timestamptz,
  ADD COLUMN IF NOT EXISTS refresh_reason_code text
    CHECK (refresh_reason_code IS NULL OR refresh_reason_code IN
      ('information_updated', 'attestation_updated', 'periodic_refresh_due',
       'access_update_required', 'arrangement_updated'));

ALTER TABLE aml.reliance_grants
  ADD COLUMN IF NOT EXISTS refresh_required_at timestamptz,
  ADD COLUMN IF NOT EXISTS refresh_reason_code text
    CHECK (refresh_reason_code IS NULL OR refresh_reason_code IN
      ('information_updated', 'attestation_updated', 'periodic_refresh_due',
       'access_update_required', 'arrangement_updated'));

-- Flag only — the determination row's decision content is never edited.
ALTER TABLE aml.independent_assessments
  ADD COLUMN IF NOT EXISTS refresh_required_at timestamptz;

-- ── 5. Partner refresh obligations (§6.6) ─────────────────────────────────

CREATE TABLE IF NOT EXISTS aml.partner_refresh_obligations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL DEFAULT 'default',
  case_id uuid NOT NULL REFERENCES aml.cases(id) ON DELETE CASCADE,
  partner_org_id uuid NOT NULL REFERENCES aml.partner_organisations(id),
  partner_case_link_id uuid NOT NULL REFERENCES aml.partner_case_links(id),
  grant_id uuid REFERENCES aml.reliance_grants(id),
  attestation_id uuid REFERENCES aml.compliance_attestations(id),
  determination_id uuid REFERENCES aml.independent_assessments(id),
  trigger_source text NOT NULL CHECK (trigger_source IN
    ('material_change', 'revocation', 'arrangement_review', 'manual')),
  -- Staff-only classification of WHAT changed (field groups, never content).
  -- Never included in any partner-facing response.
  internal_trigger_codes text[] NOT NULL DEFAULT ARRAY[]::text[],
  -- The ONLY reason a partner ever sees. Closed catalogue, safe wording.
  safe_reason_code text NOT NULL CHECK (safe_reason_code IN
    ('information_updated', 'attestation_updated', 'periodic_refresh_due',
     'access_update_required', 'arrangement_updated')),
  required_action text NOT NULL DEFAULT 'review_and_redetermine'
    CHECK (required_action IN ('review_and_redetermine', 'acknowledge_access_change')),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'completed', 'cancelled', 'expired')),
  due_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  completed_by_source text CHECK (completed_by_source IS NULL OR completed_by_source IN
    ('finance_portal_users', 'builder_portal_users', 'solicitor_portal_users')),
  completed_by_id uuid,
  -- The exact content hash the partner completed against, when one exists.
  completed_against_attestation_hash text,
  cancelled_at timestamptz,
  cancelled_by uuid,
  cancel_note text,
  correlation_id uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partner_refresh_obligation_completion_coherent CHECK (
    (status <> 'completed' OR completed_at IS NOT NULL)
    AND (status <> 'cancelled' OR cancelled_at IS NOT NULL)
  )
);

-- ONE open obligation per link × action. A duplicate or replayed refresh
-- event structurally cannot create a second active obligation.
CREATE UNIQUE INDEX IF NOT EXISTS uq_aml_refresh_obligation_open
  ON aml.partner_refresh_obligations (partner_case_link_id, required_action)
  WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_aml_refresh_obligations_org
  ON aml.partner_refresh_obligations (partner_org_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_aml_refresh_obligations_case
  ON aml.partner_refresh_obligations (case_id, status);

DROP TRIGGER IF EXISTS trg_aml_refresh_obligations_updated_at
  ON aml.partner_refresh_obligations;
CREATE TRIGGER trg_aml_refresh_obligations_updated_at
  BEFORE UPDATE ON aml.partner_refresh_obligations
  FOR EACH ROW EXECUTE FUNCTION aml.touch_updated_at();

-- ── 6. Partner notifications (the worker's idempotent destination) ────────
-- Safe copy only, keyed UNIQUE on the outbox event id: processing the same
-- event twice yields exactly one row. In-app rows read through aml-reliance;
-- nothing here sends anything anywhere.

CREATE TABLE IF NOT EXISTS aml.partner_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outbox_event_id uuid NOT NULL UNIQUE,
  partner_org_id uuid NOT NULL REFERENCES aml.partner_organisations(id),
  partner_case_link_id uuid REFERENCES aml.partner_case_links(id),
  event_type text NOT NULL,
  safe_reason_code text,
  title text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_aml_partner_notifications_org
  ON aml.partner_notifications (partner_org_id, created_at DESC);

GRANT ALL ON aml.partner_refresh_obligations, aml.partner_notifications TO service_role;
ALTER TABLE aml.partner_refresh_obligations ENABLE ROW LEVEL SECURITY;
ALTER TABLE aml.partner_notifications ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['partner_refresh_obligations','partner_notifications'] LOOP
    BEGIN
      EXECUTE format(
        'CREATE POLICY "aml_%s_service_only" ON aml.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
        t, t);
    EXCEPTION WHEN duplicate_object THEN NULL; END;
  END LOOP;
END $$;

-- ── 7. Transition triggers: event creation atomic with the state change ───
-- AFTER ROW triggers with transition WHEN conditions. SECURITY DEFINER so a
-- direct authenticated write (legal holds allow reviewer/mlro writes) still
-- reaches the outbox. Payloads carry identifiers, controlled codes and the
-- state that changed — never free text, never internal commentary.

CREATE OR REPLACE FUNCTION aml.emit_partner_link_events()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = aml, public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM aml.enqueue_partner_event(
      'aml.partner_case_link.created', 'partner_case_link', NEW.id, 1,
      jsonb_build_object('link_id', NEW.id, 'case_id', NEW.case_id,
        'portal_type', NEW.portal_type, 'legal_route', NEW.legal_route,
        'relationship_role', NEW.relationship_role, 'state', NEW.state),
      'aml.partner_case_link.created:' || NEW.id,
      NEW.partner_org_id, NEW.id);
  ELSIF NEW.state IS DISTINCT FROM OLD.state AND NEW.state = 'suspended' THEN
    PERFORM aml.enqueue_partner_event(
      'aml.partner_case_link.suspended', 'partner_case_link', NEW.id, 1,
      jsonb_build_object('link_id', NEW.id, 'case_id', NEW.case_id, 'state', NEW.state),
      'aml.partner_case_link.suspended:' || NEW.id || ':' || COALESCE(NEW.suspended_at, now())::text,
      NEW.partner_org_id, NEW.id);
  ELSIF NEW.state IS DISTINCT FROM OLD.state AND NEW.state = 'ended' THEN
    PERFORM aml.enqueue_partner_event(
      'aml.partner_case_link.ended', 'partner_case_link', NEW.id, 1,
      jsonb_build_object('link_id', NEW.id, 'case_id', NEW.case_id, 'state', NEW.state,
        'end_reason_code', NEW.end_reason_code),
      'aml.partner_case_link.ended:' || NEW.id || ':' || COALESCE(NEW.ended_at, now())::text,
      NEW.partner_org_id, NEW.id);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_aml_emit_partner_link_events ON aml.partner_case_links;
CREATE TRIGGER trg_aml_emit_partner_link_events
  AFTER INSERT OR UPDATE ON aml.partner_case_links
  FOR EACH ROW EXECUTE FUNCTION aml.emit_partner_link_events();

CREATE OR REPLACE FUNCTION aml.emit_attestation_events()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = aml, public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM aml.enqueue_partner_event(
      'aml.attestation.issued', 'compliance_attestation', NEW.id, NEW.version,
      jsonb_build_object('attestation_id', NEW.id, 'case_id', NEW.case_id,
        'version', NEW.version, 'schema_version', COALESCE(NEW.schema_version, 1),
        'payload_sha256', NEW.payload_sha256, 'issued_reason_code', NEW.issued_reason_code),
      'aml.attestation.issued:' || NEW.id);
  ELSE
    IF OLD.superseded_at IS NULL AND NEW.superseded_at IS NOT NULL THEN
      PERFORM aml.enqueue_partner_event(
        'aml.attestation.superseded', 'compliance_attestation', NEW.id, NEW.version,
        jsonb_build_object('attestation_id', NEW.id, 'case_id', NEW.case_id,
          'version', NEW.version, 'superseded_reason_code', NEW.superseded_reason_code),
        'aml.attestation.superseded:' || NEW.id);
    END IF;
    IF OLD.refresh_required_at IS NULL AND NEW.refresh_required_at IS NOT NULL THEN
      PERFORM aml.enqueue_partner_event(
        'aml.attestation.refresh_required', 'compliance_attestation', NEW.id, NEW.version,
        jsonb_build_object('attestation_id', NEW.id, 'case_id', NEW.case_id,
          'version', NEW.version, 'safe_reason_code', NEW.refresh_reason_code),
        'aml.attestation.refresh_required:' || NEW.id || ':' || NEW.refresh_required_at::text);
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_aml_emit_attestation_events ON aml.compliance_attestations;
CREATE TRIGGER trg_aml_emit_attestation_events
  AFTER INSERT OR UPDATE ON aml.compliance_attestations
  FOR EACH ROW EXECUTE FUNCTION aml.emit_attestation_events();

CREATE OR REPLACE FUNCTION aml.emit_grant_events()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = aml, public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM aml.enqueue_partner_event(
      'aml.partner_access.created', 'reliance_grant', NEW.id, 1,
      jsonb_build_object('grant_id', NEW.id, 'case_id', NEW.case_id,
        'attestation_id', NEW.attestation_id, 'expires_at', NEW.expires_at),
      'aml.partner_access.created:' || NEW.id,
      NEW.partner_org_id, NEW.partner_case_link_id);
  ELSIF OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL THEN
    -- Deliberately NOT the free-text revoke_reason: identifiers only.
    PERFORM aml.enqueue_partner_event(
      'aml.partner_access.revoked', 'reliance_grant', NEW.id, 1,
      jsonb_build_object('grant_id', NEW.id, 'case_id', NEW.case_id),
      'aml.partner_access.revoked:' || NEW.id,
      NEW.partner_org_id, NEW.partner_case_link_id);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_aml_emit_grant_events ON aml.reliance_grants;
CREATE TRIGGER trg_aml_emit_grant_events
  AFTER INSERT OR UPDATE ON aml.reliance_grants
  FOR EACH ROW EXECUTE FUNCTION aml.emit_grant_events();

CREATE OR REPLACE FUNCTION aml.emit_records_request_events()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = aml, public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM aml.enqueue_partner_event(
      'aml.records_request.submitted', 'partner_records_request', NEW.id, 1,
      jsonb_build_object('request_id', NEW.id, 'case_id', NEW.case_id,
        'requested_record_codes', to_jsonb(NEW.requested_record_codes), 'status', NEW.status),
      'aml.records_request.submitted:' || NEW.id,
      NEW.partner_org_id, NEW.partner_case_link_id);
  ELSIF OLD.reviewed_at IS NULL AND NEW.reviewed_at IS NOT NULL THEN
    PERFORM aml.enqueue_partner_event(
      'aml.records_request.reviewed', 'partner_records_request', NEW.id, 1,
      jsonb_build_object('request_id', NEW.id, 'case_id', NEW.case_id, 'status', NEW.status,
        'approved_record_codes', to_jsonb(NEW.approved_record_codes),
        'denied_record_codes', to_jsonb(NEW.denied_record_codes)),
      'aml.records_request.reviewed:' || NEW.id || ':' || NEW.reviewed_at::text,
      NEW.partner_org_id, NEW.partner_case_link_id);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_aml_emit_records_request_events ON aml.partner_records_requests;
CREATE TRIGGER trg_aml_emit_records_request_events
  AFTER INSERT OR UPDATE ON aml.partner_records_requests
  FOR EACH ROW EXECUTE FUNCTION aml.emit_records_request_events();

CREATE OR REPLACE FUNCTION aml.emit_evidence_delivery_events()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = aml, public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM aml.enqueue_partner_event(
      'aml.evidence_delivery.created', 'partner_evidence_delivery', NEW.id, 1,
      jsonb_build_object('delivery_id', NEW.id, 'request_id', NEW.request_id,
        'case_id', NEW.case_id, 'record_code', NEW.record_code, 'expires_at', NEW.expires_at),
      'aml.evidence_delivery.created:' || NEW.id,
      NEW.partner_org_id, NEW.partner_case_link_id);
  ELSIF OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL THEN
    PERFORM aml.enqueue_partner_event(
      'aml.evidence_delivery.revoked', 'partner_evidence_delivery', NEW.id, 1,
      jsonb_build_object('delivery_id', NEW.id, 'request_id', NEW.request_id,
        'case_id', NEW.case_id, 'record_code', NEW.record_code),
      'aml.evidence_delivery.revoked:' || NEW.id,
      NEW.partner_org_id, NEW.partner_case_link_id);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_aml_emit_evidence_delivery_events ON aml.partner_evidence_deliveries;
CREATE TRIGGER trg_aml_emit_evidence_delivery_events
  AFTER INSERT OR UPDATE ON aml.partner_evidence_deliveries
  FOR EACH ROW EXECUTE FUNCTION aml.emit_evidence_delivery_events();

CREATE OR REPLACE FUNCTION aml.emit_determination_events()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = aml, public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- status is the controlled outcome; decision content stays out.
    PERFORM aml.enqueue_partner_event(
      'aml.partner_determination.recorded', 'independent_assessment', NEW.id, 1,
      jsonb_build_object('assessment_id', NEW.id, 'case_id', NEW.case_id,
        'status', NEW.status, 'based_on_attestation_sha256', NEW.based_on_attestation_sha256),
      'aml.partner_determination.recorded:' || NEW.id,
      NEW.partner_org_id, NEW.partner_case_link_id);
  ELSIF OLD.refresh_required_at IS NULL AND NEW.refresh_required_at IS NOT NULL THEN
    PERFORM aml.enqueue_partner_event(
      'aml.partner_determination.refresh_required', 'independent_assessment', NEW.id, 1,
      jsonb_build_object('assessment_id', NEW.id, 'case_id', NEW.case_id),
      'aml.partner_determination.refresh_required:' || NEW.id || ':' || NEW.refresh_required_at::text,
      NEW.partner_org_id, NEW.partner_case_link_id);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_aml_emit_determination_events ON aml.independent_assessments;
CREATE TRIGGER trg_aml_emit_determination_events
  AFTER INSERT OR UPDATE ON aml.independent_assessments
  FOR EACH ROW EXECUTE FUNCTION aml.emit_determination_events();

CREATE OR REPLACE FUNCTION aml.emit_retention_trigger_events()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = aml, public AS $$
BEGIN
  PERFORM aml.enqueue_partner_event(
    'aml.retention_trigger.recorded', 'retention_trigger', NEW.id, 1,
    jsonb_build_object('trigger_id', NEW.id, 'entity_type', NEW.entity_type,
      'entity_id', NEW.entity_id, 'case_id', NEW.case_id,
      'record_category', NEW.record_category, 'trigger_kind', NEW.trigger_kind,
      'minimum_retention_date', NEW.minimum_retention_date),
    'aml.retention_trigger.recorded:' || NEW.id);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_aml_emit_retention_trigger_events ON aml.retention_triggers;
CREATE TRIGGER trg_aml_emit_retention_trigger_events
  AFTER INSERT ON aml.retention_triggers
  FOR EACH ROW EXECUTE FUNCTION aml.emit_retention_trigger_events();

CREATE OR REPLACE FUNCTION aml.emit_legal_hold_events()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = aml, public AS $$
BEGIN
  -- Ops-only events; the hold REASON never leaves the holds table.
  IF TG_OP = 'INSERT' THEN
    PERFORM aml.enqueue_partner_event(
      'aml.legal_hold.added', 'legal_hold', NEW.id, 1,
      jsonb_build_object('hold_id', NEW.id, 'entity_type', NEW.entity_type,
        'entity_id', NEW.entity_id, 'case_id', NEW.case_id),
      'aml.legal_hold.added:' || NEW.id);
  ELSIF OLD.released_at IS NULL AND NEW.released_at IS NOT NULL THEN
    PERFORM aml.enqueue_partner_event(
      'aml.legal_hold.released', 'legal_hold', NEW.id, 1,
      jsonb_build_object('hold_id', NEW.id, 'entity_type', NEW.entity_type,
        'entity_id', NEW.entity_id, 'case_id', NEW.case_id),
      'aml.legal_hold.released:' || NEW.id || ':' || NEW.released_at::text);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_aml_emit_legal_hold_events ON aml.legal_holds;
CREATE TRIGGER trg_aml_emit_legal_hold_events
  AFTER INSERT OR UPDATE ON aml.legal_holds
  FOR EACH ROW EXECUTE FUNCTION aml.emit_legal_hold_events();

-- ── 8. The material-change core (§6.5) — one transaction ──────────────────
-- The edge function evaluates WHAT changed (recomputing the material-input
-- hash with the Phase 3 module); this RPC applies the consequences
-- atomically. Everything is transition-guarded, so a duplicate call is a
-- no-op: refresh flags set once, ONE open obligation per link × action,
-- events emitted only on genuine transitions (trigger WHEN clauses).
--
-- What this function NEVER touches: aml.cases (risk_rating, service gate,
-- outcome), aml.service_gate_decisions, screening, or any reviewer/MLRO
-- assessment content. A partner-driven refresh cannot move the origin case.

CREATE OR REPLACE FUNCTION aml.apply_partner_material_change(
  _case_id uuid,
  _attestation_id uuid,
  _new_material_hash text,
  _changed_groups text[],
  _safe_reason_code text,
  _mode text DEFAULT 'refresh',
  _actor_user_id uuid DEFAULT NULL,
  _due_days integer DEFAULT 14,
  _correlation_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = aml, public AS $$
DECLARE
  att record;
  grants_flagged integer := 0;
  grants_revoked integer := 0;
  determinations_flagged integer := 0;
  obligations_created integer := 0;
  attestation_flagged boolean := false;
BEGIN
  IF NOT aml.partner_events_enabled() THEN
    RAISE EXCEPTION 'aml_partner_event_outbox is disabled';
  END IF;
  IF _mode NOT IN ('refresh', 'revoke') THEN
    RAISE EXCEPTION 'mode must be refresh or revoke';
  END IF;
  IF _safe_reason_code NOT IN ('information_updated', 'attestation_updated',
    'periodic_refresh_due', 'access_update_required', 'arrangement_updated') THEN
    RAISE EXCEPTION 'unknown safe_reason_code';
  END IF;

  SELECT * INTO att FROM aml.compliance_attestations
    WHERE id = _attestation_id AND case_id = _case_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'attestation not found for case'; END IF;
  IF att.superseded_at IS NOT NULL THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'attestation_already_superseded');
  END IF;
  IF COALESCE(att.schema_version, 1) <> 2 OR att.material_input_hash IS NULL THEN
    RAISE EXCEPTION 'material-change invalidation requires a v2 attestation with a material-input hash';
  END IF;
  IF att.material_input_hash = _new_material_hash THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'no_material_change');
  END IF;

  -- 1. Flag the attestation (once). The refresh_required transition trigger
  --    emits aml.attestation.refresh_required in this same transaction.
  UPDATE aml.compliance_attestations
     SET refresh_required_at = now(), refresh_reason_code = _safe_reason_code
   WHERE id = att.id AND refresh_required_at IS NULL;
  attestation_flagged := FOUND;

  -- 2. Grants on this attestation: refresh-required, or revoked when policy
  --    requires. Transition-guarded; the grant trigger emits on revocation.
  IF _mode = 'revoke' THEN
    UPDATE aml.reliance_grants
       SET revoked_at = now(), revoked_by = _actor_user_id,
           revoke_reason = 'material_change: ' || _safe_reason_code
     WHERE attestation_id = att.id AND revoked_at IS NULL;
    GET DIAGNOSTICS grants_revoked = ROW_COUNT;
  ELSE
    UPDATE aml.reliance_grants
       SET refresh_required_at = now(), refresh_reason_code = _safe_reason_code
     WHERE attestation_id = att.id AND revoked_at IS NULL AND refresh_required_at IS NULL;
    GET DIAGNOSTICS grants_flagged = ROW_COUNT;
  END IF;

  -- 3. Determinations pinned to the now-stale content hash: flag only —
  --    the decision row itself is history and is never edited.
  UPDATE aml.independent_assessments
     SET refresh_required_at = now()
   WHERE case_id = _case_id
     AND based_on_attestation_sha256 = att.payload_sha256
     AND refresh_required_at IS NULL;
  GET DIAGNOSTICS determinations_flagged = ROW_COUNT;

  -- 4. One open obligation per affected canonical link. Legacy grants
  --    without a canonical link get the grant-level flag above only.
  --    ON CONFLICT (partial unique) makes replays create nothing.
  INSERT INTO aml.partner_refresh_obligations
    (tenant_id, case_id, partner_org_id, partner_case_link_id, grant_id,
     attestation_id, trigger_source, internal_trigger_codes, safe_reason_code,
     required_action, due_at, created_by, correlation_id)
  SELECT DISTINCT ON (g.partner_case_link_id)
     l.tenant_id, _case_id, g.partner_org_id, g.partner_case_link_id, g.id,
     att.id, 'material_change', COALESCE(_changed_groups, ARRAY[]::text[]),
     _safe_reason_code, 'review_and_redetermine',
     now() + make_interval(days => GREATEST(_due_days, 1)),
     _actor_user_id, _correlation_id
  FROM aml.reliance_grants g
  JOIN aml.partner_case_links l ON l.id = g.partner_case_link_id
  WHERE g.attestation_id = att.id
    AND g.partner_org_id IS NOT NULL
    AND g.partner_case_link_id IS NOT NULL
    AND l.state = 'active'
  ORDER BY g.partner_case_link_id, g.granted_at DESC
  ON CONFLICT (partner_case_link_id, required_action) WHERE status = 'open' DO NOTHING;
  GET DIAGNOSTICS obligations_created = ROW_COUNT;

  RETURN jsonb_build_object(
    'applied', true,
    'attestation_flagged', attestation_flagged,
    'grants_flagged', grants_flagged,
    'grants_revoked', grants_revoked,
    'determinations_flagged', determinations_flagged,
    'obligations_created', obligations_created);
END $$;

REVOKE ALL ON FUNCTION aml.apply_partner_material_change(uuid, uuid, text, text[], text, text, uuid, integer, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION aml.apply_partner_material_change(uuid, uuid, text, text[], text, text, uuid, integer, uuid)
  TO service_role;

-- ── 9. Feature flag (default OFF; enabling is an operator decision) ───────

INSERT INTO public.feature_flags (key, value, description)
VALUES
  ('aml_partner_event_outbox', 'false'::jsonb,
   'AML partner domain Phase 6: record partner compliance events on the platform integration outbox (atomic domain triggers), enable material-change invalidation, refresh obligations and the worker''s AML delivery consumer. Off = no events are recorded and nothing changes. Staged enablement: see docs/aml/partner-events-and-refresh.md.')
ON CONFLICT (key) DO NOTHING;
