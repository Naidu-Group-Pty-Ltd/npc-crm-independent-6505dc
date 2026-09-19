-- Correction: allow the 'aml' notification category.
--
-- Found by real-browser staging E2E, not by reading code. 20260831000100's
-- tg_notify_client_request() writes category='aml' into
-- public.client_portal_notifications, but that table's CHECK (added in
-- 20260309073634) allows only general|deal|document|message|property.
-- Because the trigger is AFTER INSERT in the same transaction, the violation
-- aborts the whole insert: with 20260831000100 applied and this fix absent,
-- NO client request can be created at all.
--
-- Verified read-only against production before writing:
--   CHECK ((category = ANY (ARRAY['general','deal','document','message','property'])))
-- 20260831000100 is not applied to production, so the two land together; this
-- correction is separate (not an edit to 20260831000100) because that
-- migration has already been applied to the staging branch.
--
-- ROLLBACK:
--   ALTER TABLE public.client_portal_notifications
--     DROP CONSTRAINT IF EXISTS client_portal_notifications_category_check;
--   ALTER TABLE public.client_portal_notifications
--     ADD CONSTRAINT client_portal_notifications_category_check
--     CHECK (category IN ('general','deal','document','message','property'));
--   -- (only safe once no row uses category='aml')

ALTER TABLE public.client_portal_notifications
  DROP CONSTRAINT IF EXISTS client_portal_notifications_category_check;
ALTER TABLE public.client_portal_notifications
  ADD CONSTRAINT client_portal_notifications_category_check
  CHECK (category IN ('general','deal','document','message','property','aml'));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.client_portal_notifications'::regclass
      AND conname = 'client_portal_notifications_category_check'
      AND pg_get_constraintdef(oid) LIKE '%aml%'
  ) THEN
    RAISE EXCEPTION 'notification category widening did not converge';
  END IF;
END $$;
