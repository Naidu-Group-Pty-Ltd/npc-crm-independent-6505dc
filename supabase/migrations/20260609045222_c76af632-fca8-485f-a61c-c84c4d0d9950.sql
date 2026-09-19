-- 1. Patch the client_activities check constraint to recognise new activity
--    types that the finance portal emits when partners create/import clients.
ALTER TABLE public.client_activities
  DROP CONSTRAINT IF EXISTS client_activities_activity_type_check;

ALTER TABLE public.client_activities
  ADD CONSTRAINT client_activities_activity_type_check CHECK (
    activity_type = ANY (ARRAY[
      'note_added','file_uploaded','reminder_created','reminder_completed',
      'tag_added','tag_removed','property_added','property_updated',
      'score_updated','contact_made','meeting','email_sent','status_changed',
      'client_created','client_imported','custom'
    ])
  );

-- 2. Patch the finance_portal_activity_log actor_type check so it accepts
--    the 'finance_partner' value the function emits without falling over.
ALTER TABLE public.finance_portal_activity_log
  DROP CONSTRAINT IF EXISTS finance_portal_activity_actor_type_check;

ALTER TABLE public.finance_portal_activity_log
  ADD CONSTRAINT finance_portal_activity_actor_type_check CHECK (
    actor_type = ANY (ARRAY['finance_user','finance_partner','staff','system'])
  );
