-- AML events may be written by either native Supabase Auth users or staff
-- authenticated through public.custom_users/public.user_sessions. Keep the
-- application actor UUID and label in the immutable event without requiring the
-- UUID to exist in auth.users.
ALTER TABLE aml.case_events
  DROP CONSTRAINT IF EXISTS case_events_actor_id_fkey;

COMMENT ON COLUMN aml.case_events.actor_id IS
  'Application user id. May reference a custom_users account or a native Supabase Auth user, depending on the login surface.';
