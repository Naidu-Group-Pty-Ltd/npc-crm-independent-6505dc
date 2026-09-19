-- WP-15 — Live database verification queries
--
-- READ-ONLY. Run against the deployed Supabase project (SQL editor or psql) as
-- a privileged role. All queries are non-destructive and pull posture data
-- directly from Postgres catalogs. Any surprising row in these outputs is a
-- launch blocker per WP-15 §22.5.
--
-- Ordering mirrors the restricted security program's approved verification plan.

------------------------------------------------------------------------------
-- 1. RLS + FORCE RLS coverage on every table in public / storage / aml.
--    Expect: every relation reports relrowsecurity = true. Any false row is a
--    launch blocker unless explicitly documented as fully public.
------------------------------------------------------------------------------
select n.nspname as schema,
       c.relname as table,
       c.relrowsecurity     as rls_enabled,
       c.relforcerowsecurity as force_rls
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r','p')
  and n.nspname in ('public','storage','aml')
order by 1, 2;

------------------------------------------------------------------------------
-- 2. Policies with always-true / permissive conditions.
--    Any row whose `qual` or `with_check` collapses to `true` (or NULL for
--    permissive policies) must be justified. Compare against
--    docs/security/RLS_ANALYSIS.md.
------------------------------------------------------------------------------
select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname in ('public','storage','aml')
order by 1, 2, 3;

------------------------------------------------------------------------------
-- 3. SECURITY DEFINER functions exposed to client-facing roles.
--    Every row here must map to a documented public RPC (has_role,
--    get_aml_roles_for_user, cron_service_role_headers, etc.). Anything else
--    is a privilege-escalation surface.
------------------------------------------------------------------------------
select n.nspname as schema,
       p.proname as function,
       pg_get_function_identity_arguments(p.oid) as args,
       has_function_privilege('anon',          p.oid, 'EXECUTE') as anon_exec,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec,
       has_function_privilege('public',        p.oid, 'EXECUTE') as public_exec
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where p.prosecdef
  and (
       has_function_privilege('anon',          p.oid, 'EXECUTE')
    or has_function_privilege('authenticated', p.oid, 'EXECUTE')
    or has_function_privilege('public',        p.oid, 'EXECUTE')
  )
order by 1, 2;

------------------------------------------------------------------------------
-- 4. Sensitive bucket privacy.
--    Expect `public = false` on every bucket that stores client PII, PDFs,
--    signed documents, agreements, finance artifacts. Public buckets are
--    only acceptable for anonymised marketing assets.
------------------------------------------------------------------------------
select id, public, file_size_limit, allowed_mime_types
from storage.buckets
order by id;

------------------------------------------------------------------------------
-- 5. Direct storage policies on storage.objects.
--    Cross-reference every row with a corresponding entry in
--    public.storage_object_bindings (WP-06). Broad `true` policies must be
--    scoped by bucket_id + owner + binding presence.
------------------------------------------------------------------------------
select policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'storage'
  and tablename  = 'objects'
order by policyname;

------------------------------------------------------------------------------
-- 6. Table-level grants for the client-facing roles.
--    Any anon/authenticated/public grant on a table that carries PII, session
--    material, secrets, or financial ledgers is a launch blocker.
------------------------------------------------------------------------------
select table_schema, table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema in ('public','storage','aml')
  and grantee in ('anon','authenticated','public')
order by 1, 2, 3, 4;

------------------------------------------------------------------------------
-- 7. Postgres + Auth platform posture.
--    Confirm patch level and that leaked-password protection is on.
------------------------------------------------------------------------------
select version();
show server_version;

-- Confirm the auth schema owner and the presence of the hardened trigger set.
select tgname, tgenabled
from pg_trigger
where tgrelid = 'auth.users'::regclass
order by tgname;

------------------------------------------------------------------------------
-- 8. WP-06 storage binding coverage.
--    Every object in a sensitive bucket must have a matching binding row.
--    Non-empty result = orphan objects that would return 403 (or worse, be
--    reachable without an authz decision). Investigate before launch.
------------------------------------------------------------------------------
with sensitive_buckets as (
  select id
  from storage.buckets
  where public = false
    and id in (
      'client-files',
      'investment-reports',
      'quantitative-reports',
      'finance-partner-branding',
      'lender-submission-documents',
      'agreements',
      'aml-evidence'
    )
)
select o.bucket_id,
       count(*) filter (where b.object_path is null) as orphaned_objects,
       count(*)                                       as total_objects
from storage.objects o
join sensitive_buckets sb on sb.id = o.bucket_id
left join public.storage_object_bindings b
       on b.bucket_id   = o.bucket_id
      and b.object_path = o.name
group by o.bucket_id
order by o.bucket_id;

------------------------------------------------------------------------------
-- 9. Session hardening — WP-11A.
--    Expect zero rows: no legacy plaintext session tokens should remain in
--    finance_portal_users / client_portal_sessions / step_up_sessions.
------------------------------------------------------------------------------
select 'finance_portal_users'   as source, count(*) as legacy_plaintext_tokens
from public.finance_portal_users where token_hash is null and session_token is not null
union all
select 'client_portal_sessions', count(*)
from public.client_portal_sessions where token_hash is null and session_token is not null
union all
select 'step_up_sessions',       count(*)
from public.step_up_sessions      where token_hash is null;

------------------------------------------------------------------------------
-- 10. Cron surface — WP-03.
--     Every scheduled http job must fetch its Authorization header from the
--     Vault-backed helper. Any command still containing `Bearer eyJ` in
--     plaintext is a launch blocker.
------------------------------------------------------------------------------
select jobid, jobname,
       schedule,
       (command ~* 'bearer\s+eyj') as embeds_plaintext_jwt
from cron.job
order by jobname;
