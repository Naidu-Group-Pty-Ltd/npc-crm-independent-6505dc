
-- Split fn_lender_submission_status_change into BEFORE (auto-stamp) and AFTER (timeline + notification)
-- The prior BEFORE INSERT trigger inserted into lender_submission_timeline referencing NEW.id
-- before the parent row existed, causing FK violation on lender_submission_timeline_submission_id_fkey.

CREATE OR REPLACE FUNCTION public.fn_lender_submission_autostamp()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status) THEN
    IF NEW.status = 'submitted' AND NEW.submitted_at IS NULL THEN NEW.submitted_at := now(); END IF;
    IF NEW.status IN ('conditional_approval','unconditional_approval') AND NEW.approved_at IS NULL THEN NEW.approved_at := now(); END IF;
    IF NEW.status = 'settled' AND NEW.settled_at IS NULL THEN NEW.settled_at := now(); END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.fn_lender_submission_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_label TEXT;
  v_client_name TEXT;
BEGIN
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status) THEN
    v_label := CASE NEW.status
      WHEN 'draft' THEN 'Submission drafted'
      WHEN 'pre_assessment' THEN 'Pre-assessment with lender'
      WHEN 'submitted' THEN 'Submitted to lender'
      WHEN 'conditional_approval' THEN 'Conditional approval received'
      WHEN 'unconditional_approval' THEN 'Unconditional approval received'
      WHEN 'loan_docs_issued' THEN 'Loan documents issued'
      WHEN 'settled' THEN 'Loan settled'
      WHEN 'declined' THEN 'Submission declined'
      WHEN 'withdrawn' THEN 'Submission withdrawn'
      ELSE NEW.status::text
    END;

    BEGIN
      INSERT INTO public.lender_submission_timeline (submission_id, event_type, event_label, actor_id, payload)
      VALUES (
        NEW.id,
        CASE WHEN TG_OP='INSERT' THEN 'created' ELSE 'status_change' END,
        v_label,
        COALESCE(NEW.assigned_broker_id, NEW.created_by),
        jsonb_build_object(
          'from', CASE WHEN TG_OP='UPDATE' THEN OLD.status::text ELSE NULL END,
          'to', NEW.status::text,
          'lender_name', NEW.lender_name
        )
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'submission timeline insert skipped: %', SQLERRM;
    END;

    BEGIN
      SELECT (primary_first_name || ' ' || primary_surname) INTO v_client_name
      FROM public.clients WHERE id = NEW.client_id;

      INSERT INTO public.notifications (user_id, type, title, body, link, metadata)
      VALUES (
        COALESCE(NEW.assigned_broker_id, NEW.created_by),
        'lender_submission_status',
        format('%s — %s', NEW.lender_name, v_label),
        format('%s submission for %s', NEW.lender_name, COALESCE(v_client_name, 'client')),
        format('/clients/%s?tab=submissions&highlight=%s', NEW.client_id, NEW.id),
        jsonb_build_object('submission_id', NEW.id, 'status', NEW.status::text)
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'submission notification skipped: %', SQLERRM;
    END;
  END IF;

  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_lender_submission_status_change ON public.lender_submissions;
DROP TRIGGER IF EXISTS trg_lender_submission_autostamp ON public.lender_submissions;

CREATE TRIGGER trg_lender_submission_autostamp
BEFORE INSERT OR UPDATE OF status ON public.lender_submissions
FOR EACH ROW EXECUTE FUNCTION public.fn_lender_submission_autostamp();

CREATE TRIGGER trg_lender_submission_status_change
AFTER INSERT OR UPDATE OF status ON public.lender_submissions
FOR EACH ROW EXECUTE FUNCTION public.fn_lender_submission_status_change();
