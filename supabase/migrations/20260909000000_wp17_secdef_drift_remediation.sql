-- =============================================================================
-- WP-17: close the SECURITY DEFINER / search_path drift that reopened after the
--        21 July hardening.
-- =============================================================================
--
-- `docs/security/REMEDIATION_FINAL_STATUS_2026-07-21.md` signed off at:
--
--     security_definer_view                        3 -> 0
--     *_security_definer_function_executable     116 -> 9
--     function_search_path_mutable                 8 -> 0
--
-- Three weeks later the live advisor read 2 / 96 / 5. Nothing regressed the
-- fixes; the fixes were one-off migrations rather than invariants, and 323
-- migrations have landed since — 136 of them creating or altering SECURITY
-- DEFINER objects. Every new object starts with `EXECUTE` granted to PUBLIC and
-- no `search_path`, and there was no CI gate on `supabase/migrations/**` to say
-- so. `scripts/security/check-migration-security.mjs` (this work package) is
-- the part that stops it happening a third time; this migration cleans up what
-- has already accumulated.
--
-- Every classification below was derived from the live catalogue, not assumed:
-- callers were traced through `supabase/functions/`, `src/`, `pg_policies` and
-- `pg_views` before anything was revoked.
--
-- This migration is idempotent and safe to re-run.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Two views run with definer rights and are readable by `anon`
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Both are owned by `postgres` with no `security_invoker`, so they read their
-- base tables with the owner's rights and RLS never applies. Both are granted
-- to `anon`, i.e. reachable with the publishable key that ships in the browser
-- bundle.
--
-- `partner_agreement_retention_register` is the material one: partner legal and
-- trading names, the finance agent contact id, effective/termination dates and
-- the retention disposition of every partner agreement.
--
-- Neither view has a browser reader. `partner-compliance` reads the first with
-- the service-role client; the second has no reader anywhere in the repo. So
-- switching to invoker rights and dropping the client grants costs nothing —
-- `service_role` bypasses RLS and keeps working.
ALTER VIEW public.partner_agreement_retention_register SET (security_invoker = true);
ALTER VIEW public.cross_portal_rollout_reconciliation  SET (security_invoker = true);

REVOKE ALL ON public.partner_agreement_retention_register FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.cross_portal_rollout_reconciliation  FROM PUBLIC, anon, authenticated;
GRANT  SELECT ON public.partner_agreement_retention_register TO service_role;
GRANT  SELECT ON public.cross_portal_rollout_reconciliation  TO service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Five functions with a role-mutable search_path
-- ─────────────────────────────────────────────────────────────────────────────
--
-- All five are SECURITY INVOKER, so this is hygiene rather than an escalation
-- path — but an unpinned `search_path` still lets the *caller* decide which
-- schema an unqualified name resolves in, and two of these are called from
-- triggers and CHECK constraints where that is not obvious from the call site.
--
-- Pinned to match the established convention: `public` for public functions
-- (414 already do), `aml, public` for aml ones (21 already do). ALTER FUNCTION
-- sets the config without redefining the body, so no behaviour changes.
ALTER FUNCTION public.canonical_report_address_key(raw_address text)
  SET search_path = public;
ALTER FUNCTION public.resolve_investment_report_property_key(p_listing_id text, p_client_property_id uuid, p_address text)
  SET search_path = public;
ALTER FUNCTION public.is_legal_matter_transition_allowed(_from legal_matter_status, _to legal_matter_status)
  SET search_path = public;
ALTER FUNCTION aml.assert_partner_event_payload_safe(_payload jsonb, _path text)
  SET search_path = aml, public;
ALTER FUNCTION aml.tg_reject_simulator_idv()
  SET search_path = aml, public;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. SECURITY DEFINER EXECUTE, re-swept over `public` AND `aml`
-- ─────────────────────────────────────────────────────────────────────────────
--
-- `20260721180000_security_phase7_revoke_secdef_execute.sql` did this for
-- `public` only, and only for the functions that existed that day. The sweep
-- below covers both schemas and re-derives the keep-list from current use.
--
-- EXECUTE is granted to PUBLIC by default at CREATE time and `anon` inherits
-- PUBLIC, so revoking from `anon` alone is a no-op — the lesson of RLS-W5
-- (`20260725096000`). PUBLIC must be revoked and the roles that need it
-- re-granted explicitly. That is what this does.
--
-- KEEP-LIST — why each entry stays client-executable:
--
--   RLS policy predicates. Evaluated in the *querying* role's context, so the
--   querying role needs EXECUTE or every policy referencing them fails closed:
--     public.has_role, has_aml_role, has_aml_write_role, has_any_aml_role
--     public.current_user_can_view / _can_edit / _can_delete
--     aml.has_aml_role, has_any_aml_role, has_tenant_aml_role,
--     aml.has_any_tenant_aml_role, aml.is_superadmin
--
--   Deliberately reachable without a session:
--     public.get_shared_qa_answer     — the public share-token QA view; the
--                                       function gates on the token internally
--     public.resolve_report_template  — browser render path; returns
--                                       non-sensitive template structure
--
--   Called from the browser with an authenticated client (anon already revoked
--   by RLS-W3/W5, and that stays revoked):
--     public.retry_failed_bulk_items      — BulkGenerationModal retry action
--     public.api_usage_billing_breakdown  — BillingRecoveryTab; called with
--                                           `as any` casts, which is how it
--                                           escaped the first RPC census
--     public.get_all_cache_stats, get_api_health_stats, get_report_changelog
--                                         — ops helpers behind authenticated
--                                           edge functions
--
-- Everything else is revoked. Of the 54 functions that leaves:
--
--   * 40 are trigger functions. PostgREST will not expose a trigger-returning
--     function, and the trigger machinery does not consult the invoker's
--     EXECUTE privilege, so revoking cannot break a trigger. They were only
--     ever executable because CREATE grants PUBLIC by default.
--
--   * 14 are ordinary functions whose only callers are service-role edge
--     functions — verified one by one, and none is referenced by any RLS
--     policy or view definition. Several are work-queue claims
--     (`claim_workflow_trigger_events`, `claim_api_usage_for_forwarding`,
--     `claim_listing_enrichment`), which is the sharp end of this: with the
--     publishable key alone, anyone on the internet could drain a queue the
--     dispatcher was about to process.
DO $$
DECLARE
  fn record;
  -- Matched by name. Each keep-listed name has a single overload in its schema,
  -- and matching by name keeps the block resilient to signature drift.
  keep_names text[] := ARRAY[
    -- RLS policy predicates (public + aml)
    'has_role',
    'has_aml_role',
    'has_aml_write_role',
    'has_any_aml_role',
    'has_tenant_aml_role',
    'has_any_tenant_aml_role',
    'is_superadmin',
    'current_user_can_view',
    'current_user_can_edit',
    'current_user_can_delete',
    -- Deliberately reachable without a session
    'get_shared_qa_answer',
    'resolve_report_template',
    -- Browser-called with an authenticated client
    'retry_failed_bulk_items',
    'api_usage_billing_breakdown',
    'get_all_cache_stats',
    'get_api_health_stats',
    'get_report_changelog'
  ];
BEGIN
  FOR fn IN
    SELECT n.nspname AS schema,
           p.proname AS name,
           pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname IN ('public', 'aml')
       AND p.prosecdef
       AND p.proname <> ALL (keep_names)
  LOOP
    -- Edge functions reach these with the service client and must keep working.
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.%I(%s) TO service_role',
                   fn.schema, fn.name, fn.args);
    -- Remove the client-reachable surface. PUBLIC first — anon inherits it.
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %I.%I(%s) FROM PUBLIC, anon, authenticated',
                   fn.schema, fn.name, fn.args);
  END LOOP;
END $$;

-- The keep-list entries that were narrowed to `authenticated` by RLS-W3/W5 must
-- stay narrowed: the loop above skips them, so restate the intent explicitly
-- rather than relying on a previous migration having run.
REVOKE EXECUTE ON FUNCTION public.api_usage_billing_breakdown(integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.api_usage_billing_breakdown(integer) TO authenticated, service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Moot client grants on deny-all tables
-- ─────────────────────────────────────────────────────────────────────────────
--
-- 37 tables have RLS enabled and **no policy at all**. That is deny-all for
-- every role except `service_role`, and for most of them it is the intended
-- posture — this project's convention is service-role-only, with edge functions
-- as the only path (AGENTS.md §3).
--
-- But 21 of those 37 still carry INSERT/UPDATE/DELETE/TRUNCATE grants to `anon`
-- and/or `authenticated`, including `user_webauthn_credentials` and
-- `mfa_webauthn_challenges`. Nothing is exploitable today: with RLS on and no
-- policy the grants cannot be exercised. The problem is what they become. The
-- two CRITICAL vulnerabilities found during the July remediation were exactly
-- this shape — broad anon/authenticated grants sitting behind a policy that
-- later turned permissive, at which point anyone with the publishable key could
-- write. One permissive policy added in good faith re-arms all 21.
--
-- Revoked here for the 16 that have no browser reader at all. The other five —
-- agency_agreements, client_additional_contacts, client_portal_report_requests,
-- client_portal_reports, lead_source_attributions — ARE read from the browser
-- (see the WP-17 doc); those reads return nothing today because RLS denies them,
-- which is a live functional defect. Fixing them means designing real policies,
-- and that is WP-22's work, so their grants are deliberately left alone here
-- rather than being revoked and then re-granted a phase later.
DO $$
DECLARE
  t text;
  targets text[] := ARRAY[
    'agent_action_log',
    'agent_conversation_handoffs',
    'agent_conversation_shares',
    'agent_file_uploads',
    'agent_user_preferences',
    'appointment_secondary_recipients',
    'client_qa_memory',
    'email_linking_excluded_addresses',
    'finance_partner_commissions',
    'finance_partner_statement_lines',
    'finance_partner_statements',
    'ghl_rate_state',
    'mfa_webauthn_challenges',
    'migration_uploaded_source_chunks',
    'purchase_file_client_tasks',
    'user_webauthn_credentials'
  ];
BEGIN
  FOREACH t IN ARRAY targets LOOP
    IF EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = t AND c.relkind = 'r'
    ) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', t);
      -- Edge functions are the only intended path, and service_role bypasses RLS.
      EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', t);
    END IF;
  END LOOP;
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- Verify after applying:
--
--   select * from pg_catalog.pg_proc p join pg_namespace n on n.oid=p.pronamespace
--    where p.prosecdef and n.nspname in ('public','aml')
--      and has_function_privilege('anon', p.oid, 'EXECUTE');
--
-- Expect only the keep-listed predicates and the two session-free entries.
-- Then re-run the Supabase security advisor: `security_definer_view` and
-- `function_search_path_mutable` should both read 0.
-- ─────────────────────────────────────────────────────────────────────────────
