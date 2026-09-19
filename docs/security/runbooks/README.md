# Security runbooks (OPS-001)

Operational playbooks for the NPC Property Dashboard backend. These are the
"it's 2am and something is wrong" documents — written to be followed under
pressure, not read once and forgotten.

| Runbook | Use when |
|---------|----------|
| [incident-response.md](./incident-response.md) | You suspect or have confirmed a breach, data leak, account takeover, or abuse. |
| [key-rotation.md](./key-rotation.md) | A secret is (or may be) exposed, on a scheduled rotation, or an operator with access has left. |
| [live-negative-tests.md](./live-negative-tests.md) | You need evidence that a control is present in **production** and not only in git — before a launch sign-off, after a deploy, or when the tracker still says `live_negative_test: false`. |

## System facts you need before touching either runbook

- **Supabase project ref:** `dduzbchuswwbefdunfct` (region/URL: `https://dduzbchuswwbefdunfct.supabase.co`).
- **Auth model:** Staff sign in via the `custom-auth-login` edge function, which
  mints a Supabase-compatible **HS256 JWT signed with `SUPABASE_JWT_SECRET`**
  (`role=authenticated`, `sub=custom_users.id`). Client-portal users hold an
  opaque session token (rows in `client_portal_sessions`) and are **anon** to
  Supabase. There is no Supabase GoTrue password store for staff — so "reset
  everyone's password" is a `custom_users` operation, not a GoTrue one.
- **Data access:** Edge functions use the **service_role** client (bypasses RLS
  and grants). The browser bundle ships the **anon/publishable key** — treat it
  as public. RLS + grant revokes (migrations `20260721140000`–`20260721180000`)
  are the wall between anon and privileged data.
- **Frontend deploys** go through **Lovable publish** (frontend only). Edge
  functions and migrations do **not** ship via Lovable — they are applied with
  the Supabase MCP / CLI.
- **Secrets** live in Supabase Edge Function secrets (project settings →
  Functions → secrets) and in the CI/Lovable environment. `.env` is untracked.

## Severity ladder (drives urgency in both runbooks)

- **SEV-1 — full backend compromise:** `SUPABASE_SERVICE_ROLE_KEY`,
  `SUPABASE_JWT_SECRET`/`JWT_SECRET`, `SUPABASE_ACCESS_TOKEN`/
  `SB_MANAGEMENT_ACCESS_TOKEN`, or `INTERNAL_EDGE_SECRET` exposed; or confirmed
  unauthorized superadmin. Rotate immediately, page the owner.
- **SEV-2 — scoped compromise:** a single integration credential leaked
  (payment, email, GHL, DocuSign, an AI provider key), or one account taken over.
- **SEV-3 — suspicious / potential:** anomalous logs, a near-miss, a dependency
  advisory with no confirmed exploitation.
