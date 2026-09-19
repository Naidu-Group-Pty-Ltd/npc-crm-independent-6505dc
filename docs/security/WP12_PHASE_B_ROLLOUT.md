# WP-12 Phase B — Signed Internal-Call Rollout

## Status: Partial (per-receiver strict); global env flip is BLOCKED on cron-side signing.

## What shipped this pass

1. **`migration-dispatcher` migrated to signed envelopes.**
   Now uses `callInternalFunction('<worker>', body, 'migration-dispatcher')`,
   which sends `X-Internal-{Timestamp,Nonce,Caller,Key-Id,Signature}` bound
   to method + path + body hash. The dispatcher no longer forwards the
   static `x-internal-edge-secret` header downstream.

2. **All 12 GHL migration workers strict-locked.** Each worker now
   validates with `verifyInternal(supabase, req, rawBody, { strict: true,
   allowedCallers: ['migration-dispatcher'] })`. This retires the legacy
   static-secret and service-role Bearer fallbacks on these receivers and
   rejects any signature that does not declare `migration-dispatcher` as
   the caller.

   Locked functions:
   - `ghl-migrate-contacts-worker`
   - `ghl-migrate-calendars-worker`
   - `ghl-migrate-calendar-groups-worker`
   - `ghl-migrate-bookings-worker`
   - `ghl-migrate-conversations-worker`
   - `ghl-migrate-conversations-replay-worker`
   - `ghl-migrate-conversations-reset-phantoms`
   - `ghl-migrate-notes-worker`
   - `ghl-migrate-opportunities-worker`
   - `ghl-migrate-workflows-snapshot-worker`
   - `ghl-migrate-workflow-enrollments-worker`
   - `ghl-migrate-workflow-reenroll-worker`

3. **`market-updates-qa` already strict** via
   `requireHumanOrSignedInternal([...])`.

4. **Fleet redeploy** performed for all 13 receivers + dispatcher.

## Why `INTERNAL_STRICT_SIGNED=true` was NOT flipped globally

`public.cron_service_role_headers()` (see
`supabase/migrations/20260722044034_*.sql`) builds pg_cron headers from
Vault as `Authorization: Bearer <service_role_key>` + `x-internal-edge-secret: <static>`.
Both of these paths are exactly what the strict env flag disables. All 28+
active cron jobs (`finance-portal-automations-hourly`,
`market-qa-digest-runner`, `email-sync-cron`, PDF-import GC, etc.) rely on
one or both. Flipping the env now would break every cron trigger.

## Remaining P1 work (WP-12 Phase B closeout)

1. **Sign cron requests.** Options:
   - (Recommended) Add a plpgsql helper `public.cron_signed_headers(function_name text, body jsonb)` that computes the HMAC in SQL using `extensions.hmac()` (pgcrypto) and returns the full signed-envelope header set; migrate cron jobs job-by-job.
   - Alternatively, introduce a lightweight `cron-signer` edge function that the DB `cron.schedule` job calls first to obtain signed headers, then forwards.

2. **Progressive strict-lock on remaining receivers** as their callers migrate:
   - `agent-task-runner` (cron-triggered — needs signing)
   - `email-sync-cron` (cron-triggered — needs signing)
   - `auto-report-webhook` (cron-triggered + external — needs signing + webhook-secret gate retained)
   - `enrich-lead-attributions` (cron-triggered — needs signing)
   - `build-conversations-export-worker` (invoked by parent function — audit caller name)
   - `ghl-marketing-dump-worker` (invoked by parent function — audit caller name)
   - `ai-dashboard-agent` internal path (multiple callers — enumerate `allowedCallers`)

3. **Flip `INTERNAL_STRICT_SIGNED=true`** after (1) and (2) — retires the
   static-secret and service-role-Bearer legacy paths globally.

4. **Rotate `INTERNAL_EDGE_SECRET`** post-flip (overlap window supported by
   `INTERNAL_EDGE_SECRET_V2`).

## Verification runbook

- Trigger a dry-run migration job and confirm `migration-dispatcher` logs
  emit `[dispatcher]` lines and workers log successful `verifyInternal`
  outcomes with `method: 'internal_hmac'`.
- Attempt to POST directly to any `ghl-migrate-*-worker` with only a
  service-role Bearer — expect `403 Forbidden` (`internal_caller_not_allowed`
  or `missing_credentials`).
- Attempt to POST with `x-internal-caller: attacker` + a valid signature
  from an unrelated key — expect `403` (`internal_caller_not_allowed`).
