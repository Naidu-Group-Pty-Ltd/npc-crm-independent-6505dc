-- Row triggers that feed `workflow_trigger_events`.
--
-- Each payload is shaped to the catalog node's declared `outputs`, because that
-- is the contract the canvas shows and that `{{trigger.…}}` resolves against. A
-- real event and a test run's sample data therefore have identical shape — the
-- one thing that makes "it worked in a test run" mean anything.
--
-- Keys here must match `src/lib/workflow/catalog/core.ts`. A rename on either
-- side silently produces unresolved references at run time, which is exactly
-- what `triggerPayloadShape.spec.ts` exists to catch.
--
-- Only three tables are wired. `platform.portal_message_received`,
-- `document_uploaded`, `market_update_published`, `borrowing_capacity_completed`
-- and `aml_alert_raised` are modelled in the catalog but not captured here:
-- wiring a trigger to the wrong table is worse than not wiring it, and those
-- want confirming against their real sources first. They are listed in the PR
-- rather than guessed at.

BEGIN;

-- ── clients ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.capture_client_workflow_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  base jsonb;
BEGIN
  base := jsonb_build_object(
    'clientId',   NEW.id,
    'firstName',  COALESCE(NEW.primary_first_name, ''),
    'lastName',   COALESCE(NEW.primary_surname, ''),
    'email',      COALESCE(NEW.primary_email, ''),
    'phone',      COALESCE(NEW.primary_mobile, ''),
    'stage',      COALESCE(NEW.pipeline_status, ''),
    'assignedTo', NEW.assigned_team_user_id
  );

  IF TG_OP = 'INSERT' THEN
    PERFORM public.enqueue_workflow_trigger_event(
      'platform.client_created',
      'client_created:' || NEW.id::text,
      base || jsonb_build_object('source', COALESCE(NEW.lead_source, 'any'))
    );
    RETURN NEW;
  END IF;

  -- Stage changes only fire on an actual transition. `IS DISTINCT FROM` rather
  -- than `<>` so a first move away from NULL counts, which is the common case.
  IF NEW.pipeline_status IS DISTINCT FROM OLD.pipeline_status THEN
    PERFORM public.enqueue_workflow_trigger_event(
      'platform.client_stage_changed',
      -- The destination is part of the identity: moving A→B→A is two events.
      'client_stage:' || NEW.id::text || ':' || COALESCE(NEW.pipeline_status, 'null')
        || ':' || extract(epoch from COALESCE(NEW.pipeline_updated_at, now()))::bigint::text,
      base || jsonb_build_object(
        'fromStage', COALESCE(OLD.pipeline_status, ''),
        'toStage',   COALESCE(NEW.pipeline_status, '')
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS capture_client_workflow_events ON public.clients;
CREATE TRIGGER capture_client_workflow_events
  AFTER INSERT OR UPDATE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.capture_client_workflow_events();

-- ── purchase_files ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.capture_purchase_file_workflow_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  PERFORM public.enqueue_workflow_trigger_event(
    'platform.purchase_file_status_changed',
    'purchase_file_status:' || NEW.id::text || ':' || COALESCE(NEW.status, 'null')
      || ':' || extract(epoch from COALESCE(NEW.updated_at, now()))::bigint::text,
    jsonb_build_object(
      'purchaseFileId', NEW.id,
      'clientId',       NEW.client_id,
      'fromStatus',     COALESCE(OLD.status, ''),
      'toStatus',       COALESCE(NEW.status, ''),
      'settlementDate', NEW.settlement_date,
      'purchasePrice',  NEW.purchase_price
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS capture_purchase_file_workflow_events ON public.purchase_files;
CREATE TRIGGER capture_purchase_file_workflow_events
  AFTER UPDATE ON public.purchase_files
  FOR EACH ROW EXECUTE FUNCTION public.capture_purchase_file_workflow_events();

-- ── generated_reports ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.capture_generated_report_workflow_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- A report row exists from the moment generation starts, so "generated" is
  -- the transition into a finished state, not the insert.
  IF COALESCE(NEW.status, '') <> 'completed'
     OR (TG_OP = 'UPDATE' AND COALESCE(OLD.status, '') = 'completed') THEN
    RETURN NEW;
  END IF;

  PERFORM public.enqueue_workflow_trigger_event(
    'platform.report_generated',
    'report_generated:' || NEW.id::text,
    jsonb_build_object(
      'reportId',        NEW.id,
      'reportType',      COALESCE(NEW.report_type, ''),
      'clientId',        NULL,
      'propertyAddress', COALESCE(NEW.title, ''),
      'pdfUrl',          COALESCE(NEW.pdf_path, ''),
      'generatedAt',     COALESCE(NEW.generated_at, now())
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS capture_generated_report_workflow_events ON public.generated_reports;
CREATE TRIGGER capture_generated_report_workflow_events
  AFTER INSERT OR UPDATE ON public.generated_reports
  FOR EACH ROW EXECUTE FUNCTION public.capture_generated_report_workflow_events();

COMMIT;
