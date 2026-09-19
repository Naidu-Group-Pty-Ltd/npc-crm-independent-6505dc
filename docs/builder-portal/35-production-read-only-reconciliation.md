# Production Read-Only Reconciliation (Step 12)

**Project:** `dduzbchuswwbefdunfct` — NPC Property Dashboard — **PRODUCTION**
**Access mode:** read-only. `SELECT`, metadata and inventory calls only.
**Date:** 2026-08-01

> No `apply_migration`, no `deploy_edge_function`, no SQL mutation, no secret change, no storage
> change, no test user, no test organisation, no terms version, no rollout change, no invitation,
> no synthetic data and no worker deployment was executed against this project.

No secret values are printed. No personal records are printed. Production data appears only as
aggregate counts.

---

## 1. Migration history

| Metric | Value |
|---|---|
| Migrations applied | **681** |
| Migration files in the repository | **765** |
| Latest applied version | `20260802093000` |
| Pending (repo, not applied, dated ≥ `20260730100855`) | **35** |
| **Builder migrations applied** | **0 of 14** |

### Builder migrations — none present

| Migration | In production |
|---|---|
| `20260801000000_builder_portal_phase1_organisations_users` | ❌ |
| `20260801000100_builder_portal_phase1_permissions` | ❌ |
| `20260801000200_builder_portal_phase1_sessions` | ❌ |
| `20260801000300_portal_terms_multi_portal` | ❌ |
| `20260801000400_cross_portal_rollout_org_generalisation` | ❌ |
| `20260801000500_builder_portal_admin_module` | ❌ |
| `20260801000600_builder_portal_activity_log` | ❌ |
| `20260802000000_builder_portal_phase2_auth_governance` | ❌ |
| `20260803000000_builder_portal_phase3_projects` | ❌ |
| `20260804000000_builder_portal_inventory` | ❌ |
| `20260805000000_builder_portal_transactions` | ❌ |
| `20260806000000_builder_portal_construction` | ❌ |
| `20260807000000_builder_portal_delivery` | ❌ |
| `20260808000000_builder_portal_collaboration` | ❌ |
| `20260809000000_builder_portal_workspace` | ❌ |
| `20260810000000_builder_portal_release_control_plane` *(new)* | ❌ |
| `20260810000100_builder_portal_onboarding_tour` *(new)* | ❌ |

---

## 2. Schema inventory

| Object class | Count | Notes |
|---|---|---|
| Builder tables | **0** | `builder_invoices` and `build_progress_payments` are **Finance-owned** and predate the Builder programme |
| Builder functions (`builder_*`) | **0** | |
| Builder triggers | **0** | |
| Builder policies | **1** | on the Finance-owned `builder_invoices` |
| `cross_portal_*` tables | **6** | present |
| `cross_portal_firm_rollouts.portal` column | **absent** | the generalisation is not applied |
| `builder_organisation_id` columns | **absent** | same |
| Builder organisations / users / memberships | **0 / 0 / 0** | the tables do not exist |
| Builder rollout definitions | **0** | |
| Builder rollout rows / approvals | **0 / 0** | |
| Builder terms versions | **0** | |
| `builder_portal_admin` module registration | **absent** | `20260801000500` not applied |

### Cross-portal control plane

| Item | Value |
|---|---|
| Feature definitions | **8** — all Solicitor |
| Rollout rows | **0** |
| Approvals | **0** |
| `resolve_cross_portal_feature_mode(uuid, text)` | present |
| `set_cross_portal_firm_rollout(uuid, text, text, text, uuid)` | present |
| `get_cross_portal_cutover_readiness(uuid, text)` | present |
| `resolve_cross_portal_feature_mode_for(text, uuid, text)` | **absent** |

**Provenance note.** `20260730300000_controlled_cutover_legacy_retirement_phase15` is *not* in the
applied list, yet its tables and functions exist. They arrived via
`20260730221326_a4c45e75-…`, which is applied and which defines the same objects. The Phase 15
file is a re-statement using `CREATE TABLE IF NOT EXISTS` / `CREATE OR REPLACE`, so applying it
later is safe and near-no-op. This is why a naive "the cutover plane is missing" reading of the
migration table is wrong.

---

## 3. Edge Function inventory

| Metric | Value |
|---|---|
| Total functions deployed | **377** |
| Solicitor functions deployed | 14 of 14 |
| **Builder functions deployed** | **9 of 23** |

### Deployed Builder functions

`builder-portal-login`, `builder-portal-logout`, `builder-portal-verify`,
`builder-portal-accept-invite`, `builder-portal-invite`, `builder-portal-forgot-password`,
`builder-portal-reset-password`, `builder-portal-change-password`, `builder-portal-admin`

### Not deployed (14)

`builder-portal-projects`, `builder-projects-admin`, `builder-portal-inventory`,
`builder-inventory-admin`, `builder-portal-transactions`, `builder-transactions-admin`,
`builder-portal-construction`, `builder-construction-admin`, `builder-portal-delivery`,
`builder-delivery-admin`, `builder-portal-collaboration`, `builder-collaboration-admin`,
`builder-portal-workspace`, `builder-workspace-admin`

---

## 4. 🔴 Anomaly PA-1 — functions deployed ahead of their schema

**Nine Builder Edge Functions are live in production against a database with no Builder schema.**

Every one of them queries `builder_portal_users`, `builder_organisations` or
`builder_portal_sessions`. None of those tables exists. They fail at runtime.

**Exposure: none.** The failure is fail-closed at two independent layers:

1. `resolve_cross_portal_feature_mode_for` does not exist, so `isRolloutEnabled()` catches the
   RPC error and returns `false` — every organisation reads as not-enabled.
2. Every table read errors before any row could be returned.

The portal is unreachable, not leaky. There is no path by which a caller obtains data.

It remains a real hygiene defect: functions were deployed ahead of their schema, which is the
wrong order. **The production runbook applies the database before functions** to prevent
recurrence, and the pre-deployment checklist requires confirming which Builder functions are
already deployed.

---

## 5. Anomaly counts

| Anomaly | Count |
|---|---|
| Builder functions deployed without backing schema | **9** |
| Builder migrations absent | **14 of 14** (16 including this branch) |
| Partially existing Builder objects | **0** — nothing half-created |
| Builder organisations / users / memberships in production | **0 / 0 / 0** |
| Orphaned Builder rollout rows | **0** |
| Solicitor rollout rows that would be disturbed | **0** |
| Repository migration versions with duplicate prefixes | **19** |

**No partial Builder state exists.** The database is cleanly "Builder has never been deployed",
which is the easiest possible starting point — the deployment is a clean install, not a repair.

---

## 6. Configuration presence (no values read)

| Item | Method | Result |
|---|---|---|
| Secret names configured | not enumerable read-only via MCP | ⚠️ must be confirmed in the dashboard at deployment time |
| Allowed-origin readiness | `ALLOWED_ORIGINS` consumed by `_shared/auth.ts` | ⚠️ presence not verifiable read-only |
| Email-provider readiness | `RESEND_API_KEY` consumed by the invite path | ⚠️ same |
| Storage buckets | `builder-documents` required | ⚠️ not verifiable through the available read-only surface |
| Scheduled jobs / workers | no Builder worker exists | ➖ none required |
| Required extensions | `pgcrypto` (used by `digest()`) | present — the cutover plane already depends on it |

Secret **values** were never requested and are not printed. Where presence could not be established
read-only, it is reported as unverified rather than assumed — the production runbook makes each one
an explicit pre-deployment gate.
