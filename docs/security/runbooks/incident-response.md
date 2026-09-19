# Incident response runbook (OPS-001)

Follow top to bottom. Don't skip the containment step to investigate — contain
first, investigate from the preserved evidence. Read
[README.md](./README.md) for the system facts and severity ladder referenced
throughout.

## 0. Declare and record (first 5 minutes)

1. Write a one-line statement: *what you observed, when, and why you think it's an
   incident.* Start an append-only timeline (UTC timestamps, every action + who).
2. Assign severity (SEV-1/2/3 — see README). When unsure, treat as one level
   worse until proven otherwise.
3. For SEV-1, notify the project owner (admin@npcservices.com.au) out-of-band
   (phone/SMS — not a channel the attacker might read) before you start changing
   things, so the owner isn't surprised by a service_role rotation.

## 1. Contain

Pick the containment actions that match the vector. Bias toward reversible,
high-impact moves.

- **Leaked SEV-1 secret** → go straight to
  [key-rotation.md](./key-rotation.md) for that secret **now**. For
  `SUPABASE_JWT_SECRET` rotation, note that it invalidates every live staff JWT
  (all staff are logged out) — that is the point.
- **Account takeover (staff)** → in `custom_users`, set the account inactive and
  bump a session-invalidation marker; delete their rows from the staff session
  store. If superadmin, also audit `user_roles` / `user_permissions` for rows
  the attacker may have added (see §3).
- **Account takeover (portal)** → delete the user's rows in
  `client_portal_sessions`; force password reset via the portal reset flow.
- **Malicious edge-function traffic / abused function** → the fastest kill switch
  is rotating the credential the abuse relies on, or redeploying the function
  with the offending path gated. There is no per-function "disable" via Lovable;
  use the Supabase MCP/CLI to redeploy.
- **Active data exfiltration via a table** → apply a grant revoke migration
  (`REVOKE ... FROM anon, authenticated`) to slam the door, the same pattern as
  `20260721140000`. This is immediate and does not require a frontend redeploy.

## 2. Preserve evidence

Before things scroll out of retention:

- Capture Supabase **edge function logs** and **Postgres logs** for the window
  (MCP `get_logs`, or dashboard → Logs). Save to the incident folder.
- Snapshot the relevant rows: `user_roles`, `user_permissions`,
  `permission_invite_tokens`, `activity_logs`, and any table you believe was
  read/written. `SELECT ... ` into a saved file; do not mutate yet.
- Note the current advisor state (`get_advisors security`) as a point-in-time.
- Record which secrets were valid at the time (you will rotate them; you need to
  know what the attacker could have held).

## 3. Investigate — scope the blast radius

Answer, with evidence:

1. **Entry point.** Which credential/endpoint/account? Confirm from logs, not
   assumption.
2. **Privilege reached.** Did it touch service_role-only paths? Check for
   unexpected `user_roles`/`user_permissions` inserts (the closed escalation
   vector — verify the `20260721140000` revoke is still in place:
   `has_table_privilege('anon','public.user_roles','INSERT')` must be `false`).
3. **Data touched.** Cross-reference the exfil-sensitive tables
   (`client_income_sources`, `client_address_history`, `activity_logs`,
   client-portal messages/notifications, email tables). Determine read vs write.
4. **Persistence.** Look for attacker-created accounts, invite tokens, API keys,
   webhook targets, or altered `whitelabel_settings`/`global_report_settings`.
5. **Timeline.** First and last malicious action. This bounds notification scope.

## 4. Eradicate

- Rotate **every** secret the attacker could have observed, not just the proven
  one — see [key-rotation.md](./key-rotation.md). If `SUPABASE_JWT_SECRET` is in
  doubt, rotate it (forces a full staff re-login; that is acceptable).
- Remove attacker persistence: bad rows in `user_roles`/`user_permissions`,
  rogue invite tokens (`permission_invite_tokens`), attacker accounts, altered
  config rows. Restore config from a known-good value, not from "looks right".
- If code was the vector, land the fix on `claude/session-*` → PR → merge →
  Lovable republish (frontend) and MCP/CLI deploy (functions/migrations).

## 5. Recover

- Verify the closed vector is actually closed with a direct probe (e.g. an anon
  request that should now return `401`/`42501`).
- Restore normal access: re-enable accounts that were defensively disabled but
  cleared; confirm staff can log in after any JWT-secret rotation.
- Run `get_advisors security` and the CI security job; confirm 0 ERROR-level
  findings and a green `security` + `supply-chain` gate.
- Watch logs for a recurrence of the same signature for at least one business day.

## 6. Notify and close

- **Data-subject / regulator notification** is an owner + legal decision. Under
  the Australian Privacy Act / Notifiable Data Breaches scheme, an *eligible data
  breach* (unauthorized access likely to cause serious harm) must be notified to
  the OAIC and affected individuals. Provide the owner the §3 scope + §5 evidence
  so they can make that call on time. Do not self-notify externally.
- Write the post-incident review: timeline, root cause, blast radius, what
  detection missed, and concrete follow-ups (with owners). File it in
  `docs/security/`.
- Close only when: vector fixed and verified, secrets rotated, persistence
  removed, monitoring clean, and the review is written.

## Quick reference — who/where

- Owner / primary contact: admin@npcservices.com.au
- Supabase project: `dduzbchuswwbefdunfct`
- Secret store: Supabase dashboard → Project Settings → Edge Functions → Secrets
- Logs: Supabase MCP `get_logs` / dashboard → Logs; CI: GitHub Actions
- Kill-door pattern for tables: grant-revoke migration (see `20260721140000`)
