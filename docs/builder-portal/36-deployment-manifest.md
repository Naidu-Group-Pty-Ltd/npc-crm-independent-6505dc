# Builder Portal — Deployment Manifest (Step 13)

Derived from the repository and from read-only production inspection at
`origin/main` = `39cfb4b7dca1409865e469aa5fdb79fada2fe7f6`.

---

## 1. Database manifest

All 16 Builder migrations are **additive**. None drops a table or column, none truncates, none
deletes rows. Each carries pre-migration reconciliation and post-migration assertions.

| # | File | Depends on | Creates / changes | Lock & availability risk | In production |
|---|---|---|---|---|---|
| 1 | `20260801000000_builder_portal_phase1_organisations_users` | none | `builder_organisations`, `builder_portal_users` | New tables only — none | ❌ |
| 2 | `20260801000100_builder_portal_phase1_permissions` | 1 | `builder_permission_keys`, `builder_role_default_permissions`, `builder_membership_permissions`, `builder_organisation_memberships`, `builder_resolve_permission` | New tables only | ❌ |
| 3 | `20260801000200_builder_portal_phase1_sessions` | 1 | `builder_portal_sessions`, `builder_issue_session`, `builder_revoke_user_sessions` | New tables only | ❌ |
| 4 | `20260801000300_portal_terms_multi_portal` | Solicitor Phase 3 | **Widens** `portal_terms_versions` / `portal_terms_acceptances` CHECKs; adds `builder_user_id` | ⚠️ `ALTER … DROP/ADD CONSTRAINT` on a small existing table. Brief ACCESS EXCLUSIVE; rows ≈ single digits | ❌ |
| 5 | `20260801000400_cross_portal_rollout_org_generalisation` | 4, Phase 15 tables | Adds `portal` + `builder_organisation_id` to 5 rollout tables; makes `firm_id` nullable; partial unique indexes; `resolve_cross_portal_feature_mode_for`; seeds 2 Builder feature keys | ⚠️ 5 `ALTER TABLE`s. Production rollout tables hold **0 rows**, so effectively instant. Constraints added `NOT VALID` then `VALIDATE` to avoid a long exclusive lock | ❌ |
| 6 | `20260801000500_builder_portal_admin_module` | 1 | Registers the `builder_portal_admin` module | Single insert | ❌ |
| 7 | `20260801000600_builder_portal_activity_log` | 1–3 | `builder_portal_activity_log`, `builder_log_activity`, 6 `builder_admin_*` guarded commands | New tables only | ❌ |
| 8 | `20260802000000_builder_portal_phase2_auth_governance` | 1–7 | `builder_onboarding_steps`, terms/onboarding commands, reset-attempt handling | New tables only | ❌ |
| 9 | `20260803000000_builder_portal_phase3_projects` | 1–8 | `builder_developments`, `builder_projects`, `builder_project_parties`, `builder_project_access`, `builder_project_status_history`, project resolver | New tables only | ❌ |
| 10 | `20260804000000_builder_portal_inventory` | 9 | stages, buildings, lots, units, pricing, holds, reservations, allocations, status history | New tables only | ❌ |
| 11 | `20260805000000_builder_portal_transactions` | 10 | transactions, pipeline stages, parties, status history | New tables only | ❌ |
| 12 | `20260806000000_builder_portal_construction` | 11 | construction cases, stages, milestones, progress updates, photographs, date/status history | New tables only | ❌ |
| 13 | `20260807000000_builder_portal_delivery` | 12 | variations, approvals, progress claims, inspections, defects, practical completion, handover, warranty, claims | New tables only | ❌ |
| 14 | `20260808000000_builder_portal_collaboration` | 13 | documents, versions, grants, conversations, participants, messages, tasks, assignments, notifications | New tables only | ❌ |
| 15 | `20260809000000_builder_portal_workspace` | 14 | organisation settings, user preferences, workspace summary, visible activity | New tables only | ❌ |
| 16 | **`20260810000000_builder_portal_release_control_plane`** *(new)* | 5, 7, 15 | Feature metadata columns; `row_version` + trigger on rollouts; approval revocation columns; audit entity types; `builder_rollout_transition_allowed`; `get_builder_cutover_readiness`; `get_builder_operational_health`; `set_cross_portal_rollout_for`; `record_`/`revoke_cross_portal_approval_for` | ⚠️ `ALTER` on 3 rollout tables (0 rows in production) + a CHECK swap on `builder_portal_activity_log` (0 rows) | ❌ |
| 17 | **`20260810000100_builder_portal_onboarding_tour`** *(new)* | 15 | `builder_user_preferences.tour_completed_at`; `builder_complete_onboarding_tour` | Nullable column add — metadata-only, no rewrite | ❌ |

### Preconditions, assertions, forward-fix and rollback

Every migration in this set follows the same discipline:

- **Preconditions** — `RAISE EXCEPTION 'PRE-MIGRATION FAILURE: …'` if a required object is absent
  or the data is not in the expected shape.
- **Post-migration assertions** — row counts on every shared table proven unchanged; Solicitor
  command signatures proven unchanged; Builder defaults proven `off`.
- **Forward-fix strategy** — a new additive migration. Merged migration files are never edited.
- **Rollback strategy** — **do not reverse.** Every migration is additive, so the correct rollback
  is to stop *using* the new objects (set the rollout to `off`/`rollback`) rather than to drop
  them. Dropping would destroy organisation data for no benefit.

### 3. ⚠️ Unrelated pending migrations — the deployment set is NOT "everything pending"

`supabase db push` against production today would apply **35** migrations. Only **16** are Builder.

**The other 19 are unrelated work:**

| Migration | Owner |
|---|---|
| `20260730130000_atomic_solicitor_reset_attempts` | Solicitor |
| `20260730130000_fix_legal_matter_purchase_file_sync` | Legal/Finance |
| `20260730170000_solicitor_matter_access_phase1` | Solicitor |
| `20260730180000_solicitor_portal_sessions_phase2` | Solicitor |
| `20260730190000_solicitor_governance_contracts_phase3` | Solicitor |
| `20260730200000_legal_integrity_commands_phase4` | Solicitor |
| `20260730210000_transaction_case_backbone_phase5` | Shared |
| `20260730220000_field_ownership_outbox_projections_phase6` | Shared |
| `20260730220324_ead90c68-…` | unclassified |
| `20260730230000_unified_milestones_settlement_runway_phase7` | Shared |
| `20260730240000_unified_conversations_notifications_phase8` | Shared |
| `20260730250000_immutable_document_service_phase9` | Shared |
| `20260730260000_client_legal_workspace_phase10` | Solicitor |
| `20260730270000_finance_solicitor_collaboration_phase11` | Finance/Solicitor |
| `20260730280000_ai_governance_contract_intelligence_phase13` | Solicitor |
| `20260730290000_cross_portal_observability_phase14` | Shared |
| `20260730300000_controlled_cutover_legacy_retirement_phase15` | Shared |
| `20260801120000_create_client_fact_finds` | Client |
| `20260802120000_token_balance_cache_addons` | Billing |

Plus `TEMPLATE_RLS_POLICY.sql`, which has no timestamp prefix and is a template, not a migration.

### ⛔ These are inseparable from the Builder set

The Builder migrations have **hard dependencies** on the unapplied Solicitor phases:

- `20260801000300_portal_terms_multi_portal` widens `portal_terms_versions` /
  `portal_terms_acceptances`, created by **Phase 3** (`20260730190000`).
- `20260801000400_cross_portal_rollout_org_generalisation` alters the five `cross_portal_*` tables.
  Those exist in production (via `20260730221326`), so this one dependency happens to be satisfied
  — but the *file* `20260730300000` sits between them in version order.

**There is no safe Builder-only deployment set.** Per Step 13, inseparable unsafe migrations are a
blocker.

**Recommended safe explicit deployment set** — deploy in two separately-approved waves, not one
`db push`:

- **Wave A (prerequisite, separately approved by the Solicitor owners):**
  `20260730130000` ×2, `20260730170000` … `20260730300000`, `20260730220324`
- **Wave B (Builder):** `20260801000000` … `20260810000100`
- **Explicitly excluded, to be deployed by their own owners:**
  `20260801120000_create_client_fact_finds`, `20260802120000_token_balance_cache_addons`

Wave A is **out of Builder's authority**. Its content is Solicitor and shared-platform work that
has never run in production and whose risk this review has not assessed. Deploying it under a
Builder release approval would be misrepresenting what is being changed.

### 4. ⛔ Duplicate migration versions — pre-existing repository defect

**19 version prefixes are shared by two or more files.** `20260725110000` is shared by **eight**.

`supabase_migrations.schema_migrations.version` is the primary key, so **only one file per version
can ever be recorded**, and which one is applied depends on ordering the CLI does not guarantee.

Two of these sit in the Builder deployment path:

- `20260730130000` — `atomic_solicitor_reset_attempts` **and** `fix_legal_matter_purchase_file_sync`
- `20260717000000` — `add_builder_invoice_current_payment` **and** `restrict_finance_portal_notification_routing`

**Not fixed here**: correcting it means renaming merged migration files, which the delivery rules
forbid, and it is repository-wide rather than Builder-specific. It must be resolved by the platform
owners before *any* large deployment, Builder or otherwise.

---

## 2. Edge Function manifest

**23 Builder functions**, recounted — the historical figure of 23 is confirmed. Deployment order
matters only in that the database must be applied first.

| Function | Purpose | `verify_jwt` | Auth | CSRF | CORS | Deployed (prod) |
|---|---|---|---|---|---|---|
| `builder-portal-login` | External sign-in | `false` | none → issues cookie | ✔ | ✔ | ✅ |
| `builder-portal-logout` | Sign-out, revokes server-side | `false` | Builder cookie | ✔ | ✔ | ✅ |
| `builder-portal-verify` | Session resolution, org selection, session list/revoke | `false` | Builder cookie | ✔ | ✔ | ✅ |
| `builder-portal-accept-invite` | Invite acceptance | `false` | invite token | ✔ | ✔ | ✅ |
| `builder-portal-forgot-password` | Reset request | `false` | none | ✔ | ✔ | ✅ |
| `builder-portal-reset-password` | Reset completion | `false` | reset token | ✔ | ✔ | ✅ |
| `builder-portal-change-password` | Password change | `false` | Builder cookie | ✔ | ✔ | ✅ |
| `builder-portal-invite` | Issue invitation | `true` | staff JWT | ✔ | ✔ | ✅ |
| `builder-portal-admin` | **Command Centre control plane + release control** | `true` | staff JWT | ✔ | ✔ | ✅ ⚠️ must be redeployed for the release operations |
| `builder-portal-projects` | External projects | `false` | Builder cookie | ✔ | ✔ | ❌ |
| `builder-projects-admin` | Internal projects | `true` | staff JWT | ✔ | ✔ | ❌ |
| `builder-portal-inventory` | External inventory | `false` | Builder cookie | ✔ | ✔ | ❌ |
| `builder-inventory-admin` | Internal inventory | `true` | staff JWT | ✔ | ✔ | ❌ |
| `builder-portal-transactions` | External transactions | `false` | Builder cookie | ✔ | ✔ | ❌ |
| `builder-transactions-admin` | Internal transactions | `true` | staff JWT | ✔ | ✔ | ❌ |
| `builder-portal-construction` | External construction | `false` | Builder cookie | ✔ | ✔ | ❌ |
| `builder-construction-admin` | Internal construction | `true` | staff JWT | ✔ | ✔ | ❌ |
| `builder-portal-delivery` | External delivery | `false` | Builder cookie | ✔ | ✔ | ❌ |
| `builder-delivery-admin` | Internal delivery | `true` | staff JWT | ✔ | ✔ | ❌ |
| `builder-portal-collaboration` | External documents, messages, tasks | `false` | Builder cookie | ✔ | ✔ | ❌ |
| `builder-collaboration-admin` | Internal collaboration | `true` | staff JWT | ✔ | ✔ | ❌ |
| `builder-portal-workspace` | External dashboard, activity, settings, **tour completion** | `false` | Builder cookie | ✔ | ✔ | ❌ |
| `builder-workspace-admin` | Internal workspace | `true` | staff JWT | ✔ | ✔ | ❌ |

`verify_jwt = false` on the external family is **correct and required**: those callers hold a
Builder session cookie, not a Supabase JWT. Authorization is enforced inside each function by
`resolveBuilderSession` + `builderGovernanceError` + `builderCan`.

**Shared modules:** `_shared/auth.ts`, `_shared/authz.ts`, `_shared/csrfGuard.ts`,
`_shared/builderPortalAuth.ts`, `_shared/builderSessionToken.ts`, `_shared/builderSessions.ts`,
plus the per-domain `_shared/builder*.ts` helpers.

**Required shared functions:** none beyond the shared modules above. **Worker dependency: none.**

---

## 3. Secret manifest

Derived from `Deno.env.get(...)` across the Builder functions and the shared modules they import.
**No value is printed anywhere in this repository or in these documents.**

| Secret | Consumer | Required | Blocks testing if absent |
|---|---|---|---|
| `SUPABASE_URL` | all 23 | ✔ | yes — nothing works |
| `SUPABASE_SERVICE_ROLE_KEY` | all 23 | ✔ | yes |
| `SUPABASE_ANON_KEY` | shared auth | ✔ | yes |
| `ALLOWED_ORIGINS` | `_shared/auth.ts` → `createCorsHeaders` | ✔ | **yes — the browser cannot call any function without it** |
| `APP_BASE_URL` | invite / reset links | ✔ | yes — invitation and reset emails are unusable |
| `RESEND_API_KEY` | invite / forgot-password | ✔ | **yes — no invitation can be delivered** |
| `INTERNAL_EDGE_SECRET` | internal function-to-function calls | ✔ | partial |
| `TURNSTILE_SECRET_KEY` | login, when enabled | conditional | only if `REQUIRE_TURNSTILE` is on |
| `REQUIRE_TURNSTILE` | login | optional | no |
| `CORS_ALLOW_LOVABLE_PREVIEW` | shared CORS | optional | no — must be **off** in production |

Production presence could not be established read-only; each is a pre-deployment gate in the
runbook.

---

## 4. Storage manifest

| Property | Value |
|---|---|
| Bucket | **`builder-documents`** (`BUILDER_DOCUMENT_BUCKET`) |
| Public or private | **private** |
| Object path format | must start with `documents/` (`BUILDER_DOCUMENT_STORAGE_PREFIX`); `..` and leading `/` rejected by `isAcceptableStoragePath` |
| Upload size limit | ⚠️ **not enforced in code** — must be set as a bucket limit |
| MIME restrictions | `content_type` recorded, **not restricted** — must be set as a bucket allow-list |
| Quarantine behaviour | ⛔ **none — B1** |
| Malware scan behaviour | ⛔ **none — B1** |
| Signed URL lifetime | **300 s** (`BUILDER_DOCUMENT_URL_TTL_SECONDS`) |
| Storage RLS | bucket must be private; all access via service-role signed URLs |
| Download permission check | ✔ re-resolved **per request**, not at upload |
| `storage_path` exposure | ✔ stripped from every response |
| Retention / deletion / legal hold | ⛔ no retention metadata; ➖ legal hold not applicable |

---

## 5. Worker manifest

| Property | Value |
|---|---|
| Required workers | **none** |
| Required schedules | **none** |
| Retry / dead-letter / idempotency rules | ➖ not applicable — no Builder record leaves the database |
| Health monitoring | shared `portal_operational_events` / `portal_operational_alerts`, filtered `portal='builder'` |
| Required secrets | none beyond §3 |
| Deployment order | ➖ |

If B1 is remediated, a **malware-scanning worker becomes required** and this section must be
rewritten before that release.

---

## 6. Rollout manifest

| Property | Value |
|---|---|
| Feature keys | `builder_portal_identity_v1` (gates the external portal), `builder_portal_admin_v1` (descriptive; `runtime_consumed = false`) |
| Initial mode | **`off`** — asserted by the migration for every Builder feature |
| Organisation-level enablement | one organisation at a time, via `set_cross_portal_rollout_for` from the Command Centre Release tab |
| Approval process | four types — technical, security, operations, business owner — each requiring an evidence reference; revocable with a reason |
| Stable period | `minimum_stable_days`, default **7**, measured from entry into `shadow`; cleared by rollback |
| Pilot process | pilot organisation → `cutover`; every other organisation stays `off` |
| Readiness process | `get_builder_cutover_readiness`; `cutover` is refused unless `ready` |
| Rollback process | `set_cross_portal_rollout_for(..., 'rollback', ...)` — available from `shadow` and `cutover`, never gated on readiness, preserves all data |
