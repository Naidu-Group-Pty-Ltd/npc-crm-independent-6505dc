# Key & secret rotation runbook (OPS-001)

Covers scheduled rotation, emergency rotation on exposure, and operator
offboarding. Read [README.md](./README.md) first for the auth model and severity
ladder. Golden rule: **grant the new secret, deploy consumers, then revoke the
old** — reversed order causes an outage.

## When to rotate

- **Immediately (emergency):** a secret appeared in a log, screenshot, client
  bundle, git history, error report, third-party tool, or any SEV-1/SEV-2
  incident (see [incident-response.md](./incident-response.md)).
- **On offboarding:** any operator with access to the Supabase dashboard, CI, or
  Lovable leaves or loses their device — rotate everything they could read.
- **Scheduled:** Tier-1 integration keys every 90 days; Tier-0 secrets at least
  annually or per provider policy. Postgres/Supabase platform upgrades: apply the
  security update in the dashboard when advisors flag `vulnerable_postgres_version`.

## Secret inventory & blast radius

Secrets are set in **Supabase dashboard → Project Settings → Edge Functions →
Secrets** (and mirrored where CI/Lovable needs them). Enumerate current usage
from the code with:
`grep -rhoE "Deno\.env\.get\(['\"][A-Z0-9_]+['\"]\)" supabase/functions`.

### Tier 0 — full backend compromise (rotate first, always emergency)

| Secret | What it protects | Rotation notes |
|--------|------------------|----------------|
| `SUPABASE_SERVICE_ROLE_KEY` | Bypasses **all** RLS + grants. | Regenerate in dashboard → API. Every edge function reads it from the platform secret, so no per-function edit — but confirm no copy is pasted elsewhere. Redeploy not required (functions read at runtime), but validate a function call post-rotation. |
| `SUPABASE_JWT_SECRET` / `JWT_SECRET` | Signs **staff** HS256 session JWTs (`custom-auth-login`). Leak = forge any staff/superadmin. | Rotating **logs out every staff user** (all live JWTs invalid). Coordinate: rotate, then staff re-login. Both env names refer to the same signing secret — keep them consistent. |
| `SUPABASE_ACCESS_TOKEN` / `SB_MANAGEMENT_ACCESS_TOKEN` | Supabase Management API (deploy, secrets, DDL). | Revoke the PAT in Supabase account tokens; issue a new one; update CI/MCP config. |
| `INTERNAL_EDGE_SECRET` | HMAC signing for internal function-to-function requests (`auth_v2` envelope). | Rotate and redeploy all functions that sign/verify internal calls together, or in-flight internal requests fail verification. |
| `RESET_TOKEN_PEPPER` | Peppers password-reset/OTP hashes at rest. | Rotation invalidates outstanding reset tokens (acceptable). The verifier does a legacy dual-read — keep that window short, then drop the old pepper. |

### Tier 1 — scoped integration credentials (rotate on exposure/offboarding/90d)

Rotate at the **provider** first, then update the Supabase secret. Group:

- **AI providers:** `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`,
  `GEMINI_API_KEY`, `PERPLEXITY_API_KEY`, `LOVABLE_API_KEY`.
- **CRM / comms:** `GOHIGHLEVEL_API_KEY(_NEW)`, `GHL_WEBHOOK_SECRET`,
  `RESEND_API_KEY`, `MANYCHAT_API_KEY`, `MICROSOFT_CLIENT_SECRET`,
  `META_ADS_ACCESS_TOKEN`.
- **Docs / signing / voice:** `DOCUSIGN_*` (incl. `DOCUSIGN_RSA_PRIVATE_KEY`),
  `VAPI_API_KEY`, `VAPI_WEBHOOK_SECRET`, `VAPID_PRIVATE_KEY`.
- **Data / infra:** `CLOUDFLARE_API_TOKEN`, `DOMAIN_API_KEY`, `COTALITY_API_KEY`,
  `FIRECRAWL_API_KEY`, `GOOGLE_API_KEY`/`GOOGLE_MAPS_API_KEY`, `AIRTABLE_TOKEN`,
  `API2PDF_API_KEY`, `GAMMA_API_KEY`, `FIGMA_TOKEN`/`FIGMA_API_TOKEN`.
- **Internal service/cron/worker tokens** (rotate the pair on both sides):
  `AML_CRON_TOKEN`, `AUTOMATION_RUNNER_SECRET`, `MARKET_INGESTION_CRON_SECRET`,
  `TEMPLATE_IMPORT_WORKER_TOKEN`, `PDF_PARSE_SERVICE_TOKEN`,
  `PDF_PARSE_RECOVERY_TOKEN`, `WEASYPRINT_SERVICE_TOKEN`, `RENDER_SOURCE_TOKEN`,
  `TURNSTILE_SECRET_KEY`.

### Public (NOT secret — do not treat as leaked if seen)

`SUPABASE_ANON_KEY`, `SUPABASE_PUBLISHABLE_DEFAULT_KEY`, `VAPID_PUBLIC_KEY`, and
any `*_PUBLIC_*` / URL value ship in the browser bundle by design. The security
model assumes anon is public — rotation is only needed if the key format itself
is deprecated by Supabase.

## Rotation procedure (generic, safe ordering)

1. **Announce** (Tier 0 / staff-impacting): tell the owner; for
   `SUPABASE_JWT_SECRET` warn that staff will be logged out.
2. **Generate** the new value at the source of truth (provider console, or
   Supabase for platform keys). Use a strong random value for internal tokens
   (`openssl rand -hex 32`).
3. **Add** the new secret. Where the consumer supports two valid values (dual
   accept), add new **alongside** old first.
4. **Deploy consumers** so they use the new value: functions read platform
   secrets at runtime (usually no redeploy), but redeploy any function that
   hardcodes verification of a paired token; update CI/Lovable env if the secret
   lives there too.
5. **Verify** with a live probe (call a function that uses the secret; confirm
   success). For `SUPABASE_JWT_SECRET`, confirm a fresh staff login works.
6. **Revoke** the old value at the source (delete old PAT / old provider key /
   drop the legacy pepper). Do not skip — an un-revoked old secret is still a
   live credential.
7. **Record** in the rotation log: secret, reason, who, timestamp, and that the
   old value is revoked.

## Offboarding checklist (operator departs)

- [ ] Remove their Supabase dashboard, GitHub, and Lovable access.
- [ ] Revoke any personal `SUPABASE_ACCESS_TOKEN`/management PAT they issued.
- [ ] Rotate all Tier-0 secrets they could read (service_role, JWT secret,
      internal edge secret, pepper, management token).
- [ ] Rotate Tier-1 integration keys they had console access to.
- [ ] Deactivate their `custom_users` staff account and clear their sessions.
- [ ] Confirm CI/Lovable still build (secrets updated in those environments).

## Post-rotation verification

- `get_advisors security` → still 0 ERROR-level findings.
- CI `security` + `supply-chain` jobs green.
- Spot-check one edge function per rotated integration returns success.
- No spike in auth failures beyond the expected staff re-login wave.
