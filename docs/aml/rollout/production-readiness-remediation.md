# Production-readiness remediation — Client Portal linkage & IDV provider

Date: 2026-08-05. Branch `claude/aml-production-readiness-remediation` from
main `c6bc3305c`. Production project: `dduzbchuswwbefdunfct` (the only
environment; no staging exists — "Aurixa Systems" and "Lazarus" are
unrelated projects with no `aml` schema).

## Root cause 1 — portal said "no case" for a correctly-linked client

The database was never wrong: the portal user's `client_id` exactly equals
`aml.cases.client_id` for AML-2026-00001 (verified read-only in
production). The deployed `aml-client-portal` v22 embedded a `full_name`
column that production `client_portal_users` does not have; PostgREST
rejected the whole session select, the error object was discarded, every op
answered 401, and PortalAml rendered the no-case empty state on error.
Fixed: exact production column set, error kept and coded, revoked sessions
refused, and a distinct retryable error panel in the portal. **No data
correction is required for Rugesh** — visibility returns when the fixed
function deploys.

## Root cause 2 — simulator ran in production

`aml.provider_configs` is empty and `AML_PROVIDER_MODE` unset, so the
factory defaulted to the deterministic simulator: three identical synthetic
`failed` identity checks (score 0.69, same reference) were recorded against
the real case from the staff "Initiate IDV" button. Fixed: trusted
server-side environment classification (explicit `AML_ENVIRONMENT`, else
the `SUPABASE_URL` project ref identifies production), a pure fail-closed
policy with typed refusals mapped to 409 before any row exists, outages
recorded as `pending`/`provider_unavailable` (never `failed`), and the
staff workflow replaced by "Request identity verification" through the
client-request channel with a read-only readiness surface.

The simulator rows: migration `20260830000000` marks them
non-authoritative (`execution_mode='simulation'`), preserved, excluded
from risk mandatory inputs; the portal attempt allowance was always
unaffected (it counts `aml.verification_checks` — zero rows).

## Runbooks

**Simulator detected in production.** Symptom: `identity_checks.provider='simulator'`
with `environment='production'` or created post-deploy. Immediate: none
needed once this remediation deploys (the factory refuses); if seen,
treat as a deployment-drift incident: verify deployed function version,
re-deploy `aml-verification`, and record the rows non-authoritative via
the migration's classification (never delete).

**Provider outage.** Symptom: rows with `error_category='provider_unavailable'`,
readiness `unavailable`. No customer attempt is consumed. Retry after
Integration Health shows the service healthy; escalate to the operations
owner if >1h.

**Provider credential rotation.** Update `AML_VERIFICATION_SERVICE_URL`/
`AML_VERIFICATION_SERVICE_TOKEN` function secrets; readiness shows
presence booleans; run a synthetic staging verification before relying on
it.

**Client/case linkage repair.** First verify with read-only SQL that
`client_portal_users.client_id` ≠ `aml.cases.client_id` — in this
incident it was NOT a data defect. A genuine mismatch needs the exact
authoritative client established (never name/email matching), before/after
export, MLRO-authorised update of the single `client_id` value, and an
appended case event. Ambiguity = stop.

**Failed document upload / customer retry / manual sighting.** Existing
portal retry and `record_document_sighting` paths are unchanged; a staff
sighting settles a party regardless of electronic attempts.

**Rollback.** Revert the remediation commits; the migration's exact
rollback is in its header (drops the five columns per table; preserves all
rows).

## Release gates (Stage 12) — status

Staging E2E: **impossible — no staging environment exists** (gate FAIL).
Live provider: not configured (`provider_configs` empty; secret presence
unknown — booleans readable only at function runtime) (gate FAIL).
Sign-offs: none obtained (deployment/operations/MLRO/privacy owners not
recorded) (gate FAIL). Therefore:

**IMPLEMENTATION READY — PRODUCTION RELEASE BLOCKED.**

Authorised production scope once gates pass: deploy the three touched
functions + frontend, apply `20260830000000`, configure the live provider
(`provider_configs` row mode=live + service secrets), verify readiness
shows `ready_live`, confirm portal visibility, keep service blocking
false. No Rugesh data repair is in scope — the link is already correct.
