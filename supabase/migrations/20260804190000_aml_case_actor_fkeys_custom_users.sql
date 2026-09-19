-- AML case actor foreign keys → canonical Command Centre users (hotfix).
--
-- Root cause of the production failure
--   insert or update on table "cases" violates foreign key constraint
--   "cases_assigned_analyst_id_fkey"
--
-- aml.cases was created (20260716170455) with its three actor columns
-- referencing auth.users(id):
--   assigned_analyst_id / assigned_mlro_id / created_by  →  auth.users(id)
--
-- But the Command Centre does not authenticate through Supabase Auth. The
-- edge functions' verifyAuth (supabase/functions/_shared/auth.ts) resolves
-- callers against public.custom_users — session tokens via
-- public.user_sessions (whose user_id references public.custom_users) and
-- custom HS256 JWTs validated row-by-row against public.custom_users.
-- aml.role_assignments.user_id likewise holds custom_users ids (in
-- production every active AML role user_id exists in custom_users and none
-- exist in auth.users). So every real activation writes a custom_users id
-- into columns constrained to auth.users, and the insert — and with it the
-- whole aml_activate_client_open_case transaction — fails.
--
-- Fix: retarget exactly those three constraints at public.custom_users(id).
-- Same constraint names, same nullability, same NO ACTION delete/update
-- behaviour (a staff account with case history cannot be hard-deleted —
-- accountability is preserved; custom_users soft-deletes via deleted_at).
-- No table recreation, no data changes, safe to run once.

-- Refuse to retarget if any existing actor id would be orphaned by the new
-- reference. (At the time of writing aml.cases is empty in production, so
-- this is a guard for other environments, not a data migration.)
DO $$
DECLARE
  v_orphans integer;
BEGIN
  SELECT count(*) INTO v_orphans
  FROM aml.cases c
  WHERE (c.assigned_analyst_id IS NOT NULL AND NOT EXISTS (
           SELECT 1 FROM public.custom_users u WHERE u.id = c.assigned_analyst_id))
     OR (c.assigned_mlro_id IS NOT NULL AND NOT EXISTS (
           SELECT 1 FROM public.custom_users u WHERE u.id = c.assigned_mlro_id))
     OR (c.created_by IS NOT NULL AND NOT EXISTS (
           SELECT 1 FROM public.custom_users u WHERE u.id = c.created_by));

  IF v_orphans > 0 THEN
    RAISE EXCEPTION
      'aml.cases has % row(s) whose actor ids are not in public.custom_users; resolve them before retargeting the actor foreign keys',
      v_orphans;
  END IF;
END $$;

ALTER TABLE aml.cases DROP CONSTRAINT IF EXISTS cases_assigned_analyst_id_fkey;
ALTER TABLE aml.cases DROP CONSTRAINT IF EXISTS cases_assigned_mlro_id_fkey;
ALTER TABLE aml.cases DROP CONSTRAINT IF EXISTS cases_created_by_fkey;

ALTER TABLE aml.cases
  ADD CONSTRAINT cases_assigned_analyst_id_fkey
    FOREIGN KEY (assigned_analyst_id) REFERENCES public.custom_users(id),
  ADD CONSTRAINT cases_assigned_mlro_id_fkey
    FOREIGN KEY (assigned_mlro_id) REFERENCES public.custom_users(id),
  ADD CONSTRAINT cases_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES public.custom_users(id);
