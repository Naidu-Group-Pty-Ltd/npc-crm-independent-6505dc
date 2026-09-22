-- Close the one table in this database with row level security switched off.
--
-- Measured 19 Sep 2026: of 516 tables in `public` on the prime,
-- `extension_migration_status` was the ONLY one with `relrowsecurity` false.
-- Every clone inherits it, because provisioning replicates the prime's RLS
-- state and that stage is additive — it emits `enable row level security`
-- for the tables the prime has it ON and never a `disable` — so a table the
-- prime leaves open is a table every clone leaves open, for ever.
--
-- What is exposed is small and the fix is still worth making. The table is
-- documentation: two rows describing a PLAN to move `vector` and friends out
-- of the public schema, with their risks and estimated downtime. It holds no
-- customer data and no credential. But `anon` and `authenticated` could read
-- AND WRITE it with nothing but the publishable key, and a table whose rows
-- are advice about a future maintenance window is a table worth not letting
-- a stranger rewrite.
--
-- Why a superadmin SELECT policy and nothing else:
--
--   * Reads. `supabase/` and `src/` between them contain exactly one
--     reference to this table outside its own migration, and it is a comment
--     in that migration telling an operator to go and look at it. There is no
--     application reader to keep working, so the audience is the operator the
--     comment names. `has_role(auth.uid(), 'superadmin')` is the idiom this
--     schema already uses for that audience (`system_alerts` and seven more).
--
--   * Writes. None, deliberately. The rows are seeded by migration and
--     changed by whoever performs the extension move, and both of those run
--     as `service_role` or `postgres`, which BYPASS row level security
--     entirely. A write policy here would grant something nothing needs.
--
-- Enabling RLS with no INSERT/UPDATE/DELETE policy is the point rather than
-- an oversight: it is what turns "anyone with the anon key may rewrite this"
-- into "only the roles that bypass RLS may".

BEGIN;

ALTER TABLE public.extension_migration_status ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "superadmins read extension migration status"
  ON public.extension_migration_status;

CREATE POLICY "superadmins read extension migration status"
  ON public.extension_migration_status FOR SELECT
  USING (public.has_role(auth.uid(), 'superadmin'));

COMMIT;
