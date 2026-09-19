-- Stage 4/8: transactional integration for portal IDV and client requests.
--
-- Emission uses the platform's proven AFTER-trigger pattern so the event (and
-- the portal notification) are part of the originating transaction — no code
-- path can create the row without them, and a rollback creates neither.
-- public.integration_outbox base columns verified in production; nothing here
-- depends on the deferred partner-chain envelope columns.
--
-- ROLLBACK:
--   DROP TRIGGER IF EXISTS trg_aml_verification_outbox ON aml.verification_checks;
--   DROP FUNCTION IF EXISTS aml.tg_emit_verification_requested();
--   DROP TRIGGER IF EXISTS trg_aml_client_request_notify ON aml.client_requests;
--   DROP FUNCTION IF EXISTS aml.tg_notify_client_request();
--   ALTER TABLE aml.client_requests
--     DROP COLUMN IF EXISTS action_code, DROP COLUMN IF EXISTS action_target,
--     DROP COLUMN IF EXISTS notification_status, DROP COLUMN IF EXISTS notification_at,
--     DROP COLUMN IF EXISTS response_version;

-- Stage 7: closed, validated client-action vocabulary stored separately from
-- staff free text. NULL = plain informational request.
ALTER TABLE aml.client_requests
  ADD COLUMN IF NOT EXISTS action_code text
    CHECK (action_code IS NULL OR action_code IN
      ('complete_identity_verification','upload_document','update_questionnaire_section',
       'review_consent','provide_clarification','review_and_submit')),
  ADD COLUMN IF NOT EXISTS action_target jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS notification_status text NOT NULL DEFAULT 'none'
    CHECK (notification_status IN ('none','queued','delivered','failed')),
  ADD COLUMN IF NOT EXISTS notification_at timestamptz,
  ADD COLUMN IF NOT EXISTS response_version integer;

-- Stage 4: aml.verification.requested — emitted atomically when the portal
-- creates an electronic check that awaits worker processing. Payload carries
-- identifiers only: the worker loads everything else itself, and no PII or
-- storage path travels through the outbox.
CREATE OR REPLACE FUNCTION aml.tg_emit_verification_requested()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = aml, public
AS $$
BEGIN
  IF NEW.check_type = 'electronic_idv'
     AND NEW.processing_status IN ('submitted', 'queued') THEN
    INSERT INTO public.integration_outbox
      (aggregate_type, aggregate_id, event_type, event_version, payload, idempotency_key)
    VALUES (
      'aml_verification_check', NEW.id, 'aml.verification.requested', 1,
      jsonb_build_object(
        'verification_check_id', NEW.id,
        'case_id', NEW.case_id,
        'capture_sequence', NEW.capture_sequence
      ),
      'aml-verify-' || NEW.id::text
    )
    ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_aml_verification_outbox ON aml.verification_checks;
CREATE TRIGGER trg_aml_verification_outbox
  AFTER INSERT ON aml.verification_checks
  FOR EACH ROW EXECUTE FUNCTION aml.tg_emit_verification_requested();

-- Stage 8: a client request is not real until the client can see it. The
-- notification row and the outbox event are written in the same transaction
-- as the request. Notification copy is fixed and client-safe — staff free
-- text stays in the request record the portal already serves.
CREATE OR REPLACE FUNCTION aml.tg_notify_client_request()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = aml, public
AS $$
DECLARE
  v_client_id uuid;
BEGIN
  SELECT client_id INTO v_client_id FROM aml.cases WHERE id = NEW.case_id;
  IF v_client_id IS NOT NULL THEN
    INSERT INTO public.client_portal_notifications
      (client_id, title, message, type, category, action_url, metadata)
    VALUES (
      v_client_id,
      'Action needed on your compliance onboarding',
      'Your adviser has sent you a request. Open your compliance onboarding to respond.',
      'info', 'aml',
      '/portal/aml',
      jsonb_build_object('client_request_id', NEW.id, 'action_code', NEW.action_code)
    );
    UPDATE aml.client_requests
      SET notification_status = 'queued', notification_at = now()
      WHERE id = NEW.id;
    INSERT INTO public.integration_outbox
      (aggregate_type, aggregate_id, event_type, event_version, payload, idempotency_key)
    VALUES (
      'aml_client_request', NEW.id, 'aml.client_request.created', 1,
      jsonb_build_object('client_request_id', NEW.id, 'case_id', NEW.case_id,
                         'action_code', NEW.action_code),
      'aml-creq-' || NEW.id::text
    )
    ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_aml_client_request_notify ON aml.client_requests;
CREATE TRIGGER trg_aml_client_request_notify
  AFTER INSERT ON aml.client_requests
  FOR EACH ROW EXECUTE FUNCTION aml.tg_notify_client_request();
