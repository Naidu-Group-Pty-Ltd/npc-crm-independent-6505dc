# Controlled rollout runbook — AML/CTF partner domain (Phase 9)

Status headline: **IMPLEMENTATION COMPLETE — ROLLOUT BLOCKED.** Everything
below the "operator actions" line requires a conclusively-identified
non-production environment and the recorded sign-offs in
`pilot-signoff-register.md`. Source presence is not deployment truth;
nothing in this pack claims anything is live, deployed or operational
without direct environment evidence.

## State legend (used across the rollout pack)

| State | Meaning |
|---|---|
| source implemented | code exists on the release-candidate branch |
| locally tested | proven on the disposable local rehearsal DB / vitest / deno / Playwright-skip evidence |
| staging deployed | applied to a verified non-production project — **has not occurred** |
| staging verified | post-deployment preflight/pilot passed there — **has not occurred** |
| production not deployed | nothing in this programme has touched production |
| unknown / not verified | no direct evidence either way |

## Current state

- Phases 1–8 + remediation (classification correction, controlled P3
  evidence access, action-level flags): **source implemented, locally
  tested**.
- 60-migration chain, rollback + reapply: **locally rehearsed**
  (`supabase/tests/aml-local-rehearsal/`).
- Flag dependency order incl. one-at-a-time layer 4 and flag rollback:
  **locally rehearsed** (`14-flag-order.sql`).
- Staging: **blocked** — no deployment credentials in the build
  environment, and no project could be conclusively identified as
  non-production. Exact commands below.
- Sign-offs: **none obtained** (register lists all ten as required).
- `aml_partner_service_blocking`: false, enforced nowhere, must remain so.

## Operator actions (in order — do not reorder)

### 0. Prerequisites
1. Identify the target project and CONFIRM in writing it is non-production
   (project id, no production domain, no production client data, snapshot
   taken). Record in `environment-evidence-template.md`.
2. Name the owners: migration, rollback, worker schedule, support
   (`support-escalation-matrix.md`).

### 1. Database
```bash
supabase link --project-ref <NON-PROD-REF>
supabase db push          # applies pending migrations in order; verify the
                          # list matches migration-manifest.md before confirming
```
Then run the verification battery against the staging DB (same scripts as
the local rehearsal, steps 10–14 in `supabase/tests/aml-local-rehearsal/`).

### 2. Functions
```bash
supabase functions deploy aml-reliance
supabase functions deploy aml-records
supabase functions deploy cross-portal-outbox-worker
```
Record deployed hashes next to the source hashes in
`function-deployment-manifest.md`. Schedule the worker POST (existing
`x-worker-secret` auth) and record the schedule + owner.

### 3. Preflight
Run `get_partner_readiness` (staff credentials). Every structure probe must
read `applied`, all fourteen partner flags `disabled`, backlog `healthy`.
Resolve every `missing`/`action_required` before any flag changes.

### 4. Read-only pilot (E7)
Enable, verifying between every step (per
`feature-flag-dependency-order.md`): layer 1 (identity, arrangements,
attestation v2) → layer 2 (workspace master, operations reporting, then
finance / builder / solicitor surface flags one portal at a time —
**developer stays false**). Run the read-only UAT subset (S01–S09 of
`synthetic-uat-plan.md`) with the synthetic tenant. No write control may
appear; write ops must answer 409 (`amlPartnerActionFlags` contracts hold
server-side).

### 5. Events and retention (layer 3)
Verify the worker schedule is actually invoking (backlog drains), then
`aml_partner_event_outbox` → true; approve retention schedules per the
decision register, then `aml_partner_records_retention` → true.

### 6. Progressive writes (E8 — ONE at a time)
For each of `aml_partner_grants_write` →
`aml_partner_records_requests_write` →
`aml_partner_evidence_delivery_write` →
`aml_partner_determinations_write`: enable, run that capability's UAT
scenarios, then preflight + queues + outbox + audit events + cross-tenant
spot-check, record evidence, only then proceed. Any critical defect:
disable that flag immediately, preserve evidence, stop.

### 7. Never in this programme
`aml_partner_service_blocking` remains false. No production deployment. No
real partner enrolment. No real notifications.

## Exit gate (E13)

Phase 9 completes only when: correction implemented ✔; evidence delivery
controlled/expiring/audited ✔; local DB gate ✔; release tests ✔; synthetic
pilot executed in non-production ✖ (blocked); read-only then progressive
write rollout succeed there ✖ (blocked); rollback proven ✔ (local) / ✖
(staging); runbooks + training ✔; sign-offs recorded ✖ (none); Developer
fail-closed ✔; service blocking disabled ✔.
