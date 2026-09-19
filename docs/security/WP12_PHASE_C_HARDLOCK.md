# WP-12 Phase C — Strict Signed Hard-Lock

Status: **Complete (2026-07-24)**.

## What changed

`supabase/functions/_shared/auth_v2.ts::verifyInternal` no longer contains the
legacy static-secret shortcut (`x-internal-edge-secret` compared against
`INTERNAL_EDGE_SECRET` as a shared password) or the service-role Bearer
fallback (`Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>`). The signed
HMAC envelope (`X-Internal-Timestamp` / `X-Internal-Nonce` / `X-Internal-Caller`
/ `X-Internal-Key-Id` / `X-Internal-Signature` bound to the request body hash
and path) is now the sole trusted internal-auth path.

The `allowLegacyStaticSecret`, `allowLegacyServiceRoleKey`, and `strict`
options are retained on the function signature as **accepted-but-ignored**
parameters so existing call sites compile unchanged. Passing
`{allowLegacyStaticSecret: true}` or `{allowLegacyServiceRoleKey: true}`
emits a `[auth_v2]` warning and is otherwise treated as a no-op — the strict
path is unconditional. The `INTERNAL_STRICT_SIGNED` environment flag is no
longer consulted; it can be removed from the environment at the next
rotation cycle.

## Residual receivers

`supabase/functions/send-web-push/index.ts` is invoked directly by
`pg_cron` (via `net.http_post`) and cannot compute an HMAC in the DB layer
without the signed-headers RPC. It authenticates via
`verifyRequiredCronSecret(INTERNAL_EDGE_SECRET, x-internal-edge-secret)` —
that is a *cron shared secret*, not `verifyInternal`, and it stays covered
by the existing `check-internal-legacy-fallback.mjs` allowlist entry. All
other historic HTTP cron jobs were migrated to
`public.cron_invoke_signed_function` in WP-12 Phase B and pass through the
strict signed path.

## CI enforcement

- `scripts/security/scan-auth-patterns.mjs` R6 blocks reintroduction of the
  service-role Bearer on any inter-function call.
- `scripts/security/check-internal-legacy-fallback.mjs` blocks
  `allowLegacyStaticSecret: true`, `allowLegacyServiceRoleKey: true`, and
  any receiver reading `x-internal-edge-secret` outside
  `_shared/` / the send-web-push cron receiver.

## Verification

- `deno check` on `_shared/auth_v2.ts` — passes.
- WP-15 negative-test matrix: an unsigned inter-function call with a valid
  `INTERNAL_EDGE_SECRET` shared-secret header now returns
  `401 missing_credentials` (previously `200 OK` via the deprecated fallback).
