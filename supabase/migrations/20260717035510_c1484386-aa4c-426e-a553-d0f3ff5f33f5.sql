ALTER TABLE aml.role_assignments
  DROP CONSTRAINT IF EXISTS role_assignments_user_id_fkey;

COMMENT ON COLUMN aml.role_assignments.user_id IS
  'Application user id. May reference a custom_users account or a native Supabase Auth user, depending on the login surface.';