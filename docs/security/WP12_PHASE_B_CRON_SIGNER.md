# WP-12 Phase B — pg_cron Signed Envelope Migration Runbook

## What shipped

Two Postgres helpers (migration
`WP-12 Phase B: SQL HMAC signer for pg_cron`) that let scheduled jobs
authenticate to edge functions with the same HMAC envelope
`callInternalFunction` uses from Deno:

- `public.cron_signed_internal_headers(method, function_name, body, caller, extra) → jsonb`
- `public.cron_invoke_signed_function(function_name, body, caller) → bigint`

Signing message (identical to `signInternalRequest` in
`supabase/functions/_shared/auth_v2.ts`):

```
UPPER(METHOD)\n/functions/v1/<function>\n<epoch_s>\n<hex(nonce16)>\n<caller>\n<v1|v2>\nhex(sha256(body))
```

Signed with `INTERNAL_EDGE_SECRET_V2` when present, else
`INTERNAL_EDGE_SECRET`, both read from Vault
(`vault.decrypted_secrets`). Gateway routing uses `supabase_anon_key`
when Vault has it, otherwise falls back to `supabase_service_role_key`.

Execute privileges are restricted to `postgres` and `service_role`
(revoked from `public`/`anon`/`authenticated`).

## One-time prerequisite

Seed Vault with the project anon key so cron stops broadcasting the
service_role token as the gateway `Authorization` header:

```sql
select vault.create_secret(
  '<VITE_SUPABASE_PUBLISHABLE_KEY value>',
  'supabase_anon_key',
  'Anon/publishable key used by pg_cron for signed edge-function calls.'
);
```

If the row already exists, use `update vault.secrets set secret = …`.
Without this seed, the signer still works but keeps the service_role key
on outbound cron requests — no security regression versus today, but the
goal of WP-12 Phase B is to retire it.

## Migrating a job

### Before (legacy static secret via `cron_service_role_headers`)

```sql
select cron.schedule(
  'market-qa-digest-runner',
  '*/15 * * * *',
  $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'supabase_url' limit 1)
               || '/functions/v1/market-qa-digest-runner',
    headers := public.cron_service_role_headers(),
    body    := '{}'::jsonb
  );
  $$
);
```

### After (signed envelope)

```sql
select cron.schedule(
  'market-qa-digest-runner',
  '*/15 * * * *',
  $$ select public.cron_invoke_signed_function(
       'market-qa-digest-runner',
       '{}'::jsonb,
       'pg_cron'
     ); $$
);
```

On the receiver, tighten `verifyInternal` to strict + allowlist:

```ts
if (!(await verifyInternal(supabase, req, rawBody, {
  strict: true,
  allowedCallers: ['pg_cron'],
})).ok) {
  return json({ error: 'unauthorized' }, 403);
}
```

## Rollout order

1. **Seed** `supabase_anon_key` in Vault (above).
2. **Migrate one job** and confirm from the Supabase dashboard
   → Database → Cron → Job Runs that the request 2xx'd and the
   receiver log shows `method: 'internal_hmac'`.
3. **Batch-migrate** the remaining ~28 jobs in
   `supabase/migrations/20260722044034_*.sql` and later files. Prioritise
   destructive/high-blast jobs (`finance-portal-automations-hourly`,
   `email-sync-cron`, `auto-report-webhook`, checklist templates cron).
4. **Strict-lock** each receiver as its cron caller migrates (add
   `strict: true, allowedCallers: ['pg_cron']`).
5. **Flip global `INTERNAL_STRICT_SIGNED=true`** — retires the static
   secret and service-role-Bearer legacy paths across the fleet.
6. **Rotate `INTERNAL_EDGE_SECRET`** by moving the current value to
   `INTERNAL_EDGE_SECRET_V2`, issuing a fresh `INTERNAL_EDGE_SECRET`,
   then removing the V2 value after ≥ 90 seconds (the max signer
   skew window).

## Verification vectors

For `secret='test-secret-must-be-16-chars-long'`,
`method='POST'`, `path='/functions/v1/test-fn'`, `ts='1700000000'`,
`nonce='abcd'`, `caller='pg_cron'`, `keyId='v1'`, `body='{"hello":"world"}'`:

- `sha256(body) = 93a23971a914e5eacbf0a8d25154cda309c3c1c72fbb9914d47c60f3cb681588`
- `hmac = ac730f724095fa33b3bb14a547804567a9d45ba77587e9042a15d777d3200da1`

The SQL signer produces identical hashes when the same inputs are wired
in (verified via a Node reference implementation).
