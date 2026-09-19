-- Aurixa Agent RBAC audit — take the anon role off the agent tables.
--
-- Every agent_* table carries full CRUD grants for both `anon` and
-- `authenticated`, including TRUNCATE. Row-level security currently holds: a
-- probe as `anon` returned 0 rows on agent_skills, agent_semantic_memories,
-- agent_scheduled_tasks, agent_playbooks, agent_model_assignments and
-- agent_insights_feed, and 42501 on agent_conversations / agent_messages. Their
-- policies are correctly scoped (`user_id = auth.uid()`, service-role-only, or
-- `false`), so this is not an open door.
--
-- It is still the wrong grant, for two reasons:
--
--   1. TRUNCATE is not subject to RLS. Postgres checks the TRUNCATE privilege
--      and nothing else — no policy can restrain it. Holding it is only
--      unexploitable because PostgREST exposes no TRUNCATE verb, which makes
--      the safety a property of the HTTP layer rather than of the grant.
--   2. It leaves RLS as the sole gate. AGENTS.md is explicit that RLS is
--      additive and never the only control, and the phase-7 privilege-table
--      migration already established revoking as the house pattern.
--
-- Scope is deliberately narrow. `anon` loses everything: the agent is staff
-- tooling and an unauthenticated caller has no business on any of these tables.
-- `authenticated` keeps its DML grants, because the per-user policies on these
-- tables (agent_conversations, agent_playbooks, agent_scheduled_tasks,
-- agent_semantic_memories, agent_plans and friends) exist precisely to allow
-- scoped direct access, and revoking would disable them. Only TRUNCATE is taken
-- from authenticated — nothing in the app truncates, and it is the one
-- privilege RLS cannot check.

BEGIN;

DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    WHERE c.relkind = 'r' AND c.relname LIKE 'agent%'
  LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    EXECUTE format('REVOKE TRUNCATE ON public.%I FROM authenticated', t);
  END LOOP;
END $$;

COMMIT;
