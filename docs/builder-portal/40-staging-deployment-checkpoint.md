# Builder Portal — Staging Deployment Checkpoint (Step 15)

> **STATUS: BLOCKED — no staging environment exists.**
>
> **No write has been made to any Supabase project.** Production `dduzbchuswwbefdunfct` received
> read-only inspection only.

This is the single checkpoint required before the first staging write. It is complete and ready to
execute the moment a staging project and explicit authorisation exist.

---

## 1. Checkpoint facts

| Field | Value |
|---|---|
| Starting `origin/main` SHA | `39cfb4b7dca1409865e469aa5fdb79fada2fe7f6` |
| Release-readiness branch | `claude/builder-portal-release-readiness-2avkat` |
| Draft PR | see the PR opened from this branch |
| **Staging environment name** | ⛔ **NONE EXISTS** |
| **Staging Supabase project reference** | ⛔ **NONE** |
| Confirmation it is not `dduzbchuswwbefdunfct` | ⛔ cannot be given — there is no target to confirm |
| Current staging migration baseline | ⛔ unknown |
| Staging application URL | ⛔ none |

---

## 2. Why there is no staging project

Three Supabase projects are visible to this account:

| Project | Ref | Assessment |
|---|---|---|
| NPC Property Dashboard | `dduzbchuswwbefdunfct` | **PRODUCTION.** Read-only throughout. **Never a substitute.** |
| Aurixa Systems | `moeyytuduycrvvncdtme` | **Not staging.** A different application: 9 tables (`catalog_packs`, `catalog_plans`, `catalog_roles`, `catalog_reports`, `catalog_setups`, `catalog_addons`, `catalog_sync_state`, `leads`), 2 migrations, 11 `storefront-*` / `catalog-sync` functions. No Builder, Solicitor or NPC schema whatsoever. |
| Lazarus | `erxksncxitczkrluvsgb` | **Not staging.** A different application: `songs`, `videos`, `merch`, `journal_entries`, `profiles`, `user_roles` — all empty. |

Neither non-production project is *explicitly identified* as staging, and neither is a replica of
the NPC Property Dashboard (765 migrations, ~51 domain tables). Deploying the Builder programme
into either would corrupt an unrelated product.

The task forbids substituting production and forbids automatically creating a paid cloud project.

**Conclusion: Steps 16–21 are blocked by a verified external dependency.**

---

## 3. What must be supplied to unblock

1. A **non-production Supabase project** whose ref is **not** `dduzbchuswwbefdunfct`, ideally
   restored from a production backup so the 681-migration baseline matches.
2. Its **project ref** and **service-role credentials**.
3. A **staging application origin** (HTTPS) for `ALLOWED_ORIGINS`.
4. A **staging email provider key** (`RESEND_API_KEY`) with a controlled recipient domain.
5. Storage enabled, so the `builder-documents` bucket can be created.
6. **Explicit staging deployment authorisation**, in words, in session.

---

## 4. Exact migrations to apply

**Wave A — prerequisite, requires separate Solicitor/platform approval** (see
[`36-deployment-manifest.md`](./36-deployment-manifest.md) §3; not Builder's authority):

```
20260730130000_atomic_solicitor_reset_attempts.sql
20260730130000_fix_legal_matter_purchase_file_sync.sql     ← ⚠️ duplicate version
20260730170000_solicitor_matter_access_phase1.sql
20260730180000_solicitor_portal_sessions_phase2.sql
20260730190000_solicitor_governance_contracts_phase3.sql
20260730200000_legal_integrity_commands_phase4.sql
20260730210000_transaction_case_backbone_phase5.sql
20260730220000_field_ownership_outbox_projections_phase6.sql
20260730220324_ead90c68-a602-47a9-ac01-a7fb664dddda.sql
20260730230000_unified_milestones_settlement_runway_phase7.sql
20260730240000_unified_conversations_notifications_phase8.sql
20260730250000_immutable_document_service_phase9.sql
20260730260000_client_legal_workspace_phase10.sql
20260730270000_finance_solicitor_collaboration_phase11.sql
20260730280000_ai_governance_contract_intelligence_phase13.sql
20260730290000_cross_portal_observability_phase14.sql
20260730300000_controlled_cutover_legacy_retirement_phase15.sql
```

**Wave B — Builder, this release:**

```
20260801000000_builder_portal_phase1_organisations_users.sql
20260801000100_builder_portal_phase1_permissions.sql
20260801000200_builder_portal_phase1_sessions.sql
20260801000300_portal_terms_multi_portal.sql
20260801000400_cross_portal_rollout_org_generalisation.sql
20260801000500_builder_portal_admin_module.sql
20260801000600_builder_portal_activity_log.sql
20260802000000_builder_portal_phase2_auth_governance.sql
20260803000000_builder_portal_phase3_projects.sql
20260804000000_builder_portal_inventory.sql
20260805000000_builder_portal_transactions.sql
20260806000000_builder_portal_construction.sql
20260807000000_builder_portal_delivery.sql
20260808000000_builder_portal_collaboration.sql
20260809000000_builder_portal_workspace.sql
20260810000000_builder_portal_release_control_plane.sql      ← new
20260810000100_builder_portal_onboarding_tour.sql            ← new
```

**Explicitly EXCLUDED** — unrelated, to be deployed by their own owners:

```
20260801120000_create_client_fact_finds.sql
20260802120000_token_balance_cache_addons.sql
TEMPLATE_RLS_POLICY.sql        ← not a migration; a template with no version prefix
```

> ⚠️ **Do not run a bare `supabase db push`.** It would apply all 35 pending migrations,
> including the two excluded above, and would hit the duplicate-version defect. Apply the
> explicit list.

## 5. Exact functions to deploy

All **23** Builder Edge Functions (see [`36-deployment-manifest.md`](./36-deployment-manifest.md)
§2). **Database first, functions second** — production anomaly PA-1 is exactly what happens when
that order is reversed.

`builder-portal-admin` **must** be redeployed even though it already exists in production: the
release-control operations are new.

## 6. Shared workers to deploy

**None.** Builder requires no worker and no schedule.

## 7. Secret names required

`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `ALLOWED_ORIGINS`,
`APP_BASE_URL`, `RESEND_API_KEY`, `INTERNAL_EDGE_SECRET`, and — only if
`REQUIRE_TURNSTILE` is enabled — `TURNSTILE_SECRET_KEY`.

`CORS_ALLOW_LOVABLE_PREVIEW` may be on in staging; it must be **off** in production.

**No secret value appears in this repository, in these documents, or in any log.**

## 8. Storage changes required

Create the private bucket **`builder-documents`**; object paths under `documents/`; set a file-size
limit and a MIME allow-list at the bucket (neither is enforced in code); no public access; access
only through service-role signed URLs with a 300 s TTL.

## 9. Synthetic fixtures to create

Synthetic only. Controlled staging email addresses (`@*.test` or a controlled domain). **No real
customer data.**

One internal test administrator with `builder_portal_admin`; a test developer organisation; a test
builder organisation; a combined builder/developer organisation; a **second isolated organisation**
(the isolation control); an external owner, an administrator, a restricted member, a read-only
member, a revoked member and a suspended user; the current Builder terms version; mandatory
onboarding steps; then developments, projects, parties, access, stages, buildings, lots, units,
pricing, holds, reservations, allocations, transactions, construction cases, milestones, progress
updates, photographs, variations, progress claims, inspections, defects, practical completion,
handover, warranty, documents, versions, conversations, messages, tasks, assignments and
notifications.

## 10. Rollout plan

| Item | Value |
|---|---|
| Feature keys | `builder_portal_identity_v1`, `builder_portal_admin_v1` |
| Initial mode | **`off`** for every organisation |
| Pilot | the test builder/developer organisation → `shadow` → (after evidence) `cutover` |
| Control | the second isolated organisation stays `off` throughout, and is asserted to stay blocked |

## 11. Rollback procedure for staging

1. `set_cross_portal_rollout_for(..., 'rollback', ...)` — immediate, preserves data.
2. If a migration fails mid-way: stop on the first failed assertion, diagnose, fix on this branch,
   restore staging from the pre-deployment restore point, re-run. **Never** hand-patch staging to
   make a migration pass — that produces a schema no environment can reproduce.

## 12. Risks

| # | Risk | Mitigation |
|---|---|---|
| 1 | **B1** — Builder documents unscanned and unquarantined | Readiness blocks cutover mechanically |
| 2 | **Cookie/origin model unproven.** `__Host-builder_session_token` across app and function origins is a cross-site cookie. Whether it survives real browsers is untested | **The single highest-value thing staging must prove.** Test first, on desktop and mobile |
| 3 | Wave A has never run in production and is outside Builder's risk assessment | Separate approval by its owners |
| 4 | 19 duplicate migration versions | Apply the explicit list; never `db push` |
| 5 | `RESEND_API_KEY` absent → no invitation deliverable | Pre-deployment gate |
| 6 | `ALLOWED_ORIGINS` misconfigured → every browser call fails CORS | Pre-deployment gate; verify before fixtures |

## 13. External dependencies

Staging Supabase project · staging service-role credentials · staging HTTPS application origin ·
email provider key · storage enabled · (for B1 remediation, later) a malware-scanning provider.

---

## 14. Authorisation requested

**No explicit staging deployment authorisation has been given in this session, and no staging
project exists to authorise against.**

Execution stops here, before the first staging write, as required.

To resume: supply §3, then resume at §4 of this document. Everything upstream — review,
implementation, local validation, production inspection, manifests and runbooks — is complete.
