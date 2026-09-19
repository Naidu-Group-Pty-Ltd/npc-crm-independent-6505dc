# AGENTS.md — NPC Property Dashboard

## Mission

Maintain and improve the NPC Property Dashboard without weakening its backend
security. This repository handles client PII, financial information, email,
documents, Microsoft Graph, GHL, Airtable, ManyChat, paid AI APIs, storage,
webhooks and scheduled automation.

## Security trust boundaries

- Supabase Edge Functions frequently create service-role clients. The service
  role bypasses RLS, so in-function authentication and authorization are the
  primary trust boundary.
- `verify_jwt=false` at the gateway is acceptable only when the function performs
  strict in-function authentication appropriate to its exposure class.
- Human authentication, portal authentication, internal-service authentication,
  webhooks and public endpoints are distinct classes. Never blend them.
- Request data never establishes identity or service trust.
- The Supabase service-role key must never be sent between functions.
- Internal edge-to-edge traffic must use signed internal requests or a dedicated
  fail-closed credential approved for that exact receiver.
- Public endpoints using paid providers require quotas, request limits and a
  global kill switch.

## Existing shared modules

Prefer extending and consolidating these rather than creating competing auth
libraries:

- `supabase/functions/_shared/auth.ts`
- `supabase/functions/_shared/auth_v2.ts`
- `supabase/functions/_shared/authz.ts`
- `supabase/functions/_shared/permissions.ts`
- `supabase/functions/_shared/internalCall.ts`
- `supabase/functions/_shared/resetTokens.ts`
- `supabase/functions/_shared/notify.ts`
- `supabase/functions/_shared/reportMetering.ts`

New code must use deny-by-default helpers. Do not use allow-by-default behavior
for new or remediated sensitive paths.

## Required workflow

1. Inspect `git status`, current commit and relevant security docs before editing.
2. Trace every caller and consumer of a changed function.
3. Write or update negative tests for the vulnerability before completing the fix.
4. Keep migrations idempotent. Never edit an already-applied migration to change
   production behavior; add a new migration.
5. Do not deploy, rotate secrets or mutate production from a normal coding task.
6. Do not weaken a control merely to preserve compatibility. Use a staged
   migration, feature flag or compatibility window that remains fail closed.
7. Do not include secrets, real client data or access tokens in tests, fixtures,
   logs, commits or documentation.
8. Finish with a committed change and a clean worktree.

## Required validation

Run all commands relevant to the touched surface, including:

- `node scripts/security/check-function-registry.mjs`
- `node scripts/security/scan-auth-patterns.mjs`
- `npm run build`
- affected Vitest suites
- affected Deno tests
- `deno check` on every changed Edge Function and shared module
- migration lint/local database tests when SQL changes

If a required command cannot run, explain exactly why and provide the safest
reproducible owner command. Do not report success for an unexecuted test.

## Review checklist

Before committing, confirm:

- invalid, expired and forged credentials are rejected;
- missing secrets fail closed;
- low-privilege users cannot access another user/client/resource;
- internal callers cannot impersonate arbitrary callers;
- no service-role key appears in an inter-function request;
- paid-provider calls are metered or quota-limited;
- storage paths are bound to an authorized database record;
- mutations use explicit fields and valid state transitions;
- audit logs identify actor, action, target, decision and correlation ID;
- client responses do not contain sensitive provider/database details.
