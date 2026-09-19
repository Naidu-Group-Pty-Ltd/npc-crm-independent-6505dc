# RLS / Advisor Warning-Tier Remediation

Follow-up to the RLS critical fixes (RLS-C1 agent tables, RLS-C2 deal-financial
tables). This round closes the **warning-tier** findings: anonymous
(unauthenticated) exposure on report/asset tables, over-broad SECURITY DEFINER
EXECUTE grants, an API-exposed materialized view, and public buckets that allow
anonymous enumeration.

The governing constraint throughout: the frontend reaches some of these tables
via **direct PostgREST `.from()` REST calls on the anon-key client**, while
realtime subscriptions run on the shared client that `useAuth()` authorizes with
the staff JWT (`supabase.realtime.setAuth`). So a policy can only be tightened
**live** when no browser REST path depends on the anon role; otherwise the
frontend must first move onto the JWT client and ship (Lovable republish) before
the RLS change is applied.

## Applied live (already in production DB)

| Migration | Change |
|-----------|--------|
| `20260725092000_rls_w1_anon_exposure_livesafe.sql` | `activity_logs`, `depreciation_estimator_runs`, `charts`: dropped `public`/`anon` `USING(true)` SELECT/INSERT/ALL grants → `authenticated` + `service_role`. Realtime (authenticated) and the authed-client chart INSERT keep working; all other access is edge-function/service_role. |
| `20260725094000_rls_w3_secdef_matview_livesafe.sql` | Revoked **anon** EXECUTE on `get_api_health_stats`, `get_all_cache_stats`, `get_report_changelog` (all reached only through authenticated edge functions). Revoked anon+authenticated SELECT on the `pdf_import_cost_daily` materialized view (no app reader). |
| `20260725095000_rls_w4_bucket_listing_livesafe.sql` | `branding-assets` & `lead-magnets`: re-scoped the `SELECT TO public` storage.objects policies to `authenticated`, removing anonymous `list()` enumeration. Public object reads (getPublicUrl CDN path) and edge-served lead-magnet downloads are unaffected. |

## Staged — apply only AFTER the frontend in this PR is republished

`20260725093000_rls_w2_anon_exposure_after_republish.sql`

Tables whose browser REST access used the anon-key client. This PR moves those
call sites onto the JWT client; **apply the migration once that frontend is
live**, otherwise the current production bundle breaks.

| Table | Frontend moved to JWT client |
|-------|------------------------------|
| `generated_reports` | `src/pages/QuantitativeReports.tsx` (history read) |
| `global_report_settings` | `src/components/templates/GlobalReportSettings.tsx` (read) |
| `depreciation_comps` | `src/components/admin/DepreciationCompsAdmin.tsx` (read + writes) |
| `gamma_agreement_templates` | `src/components/agreements/GammaTemplateManager.tsx` (CRUD), `SendAgreementDialog.tsx` (read) |
| `retry_failed_bulk_items()` EXECUTE | `src/components/listings/BulkGenerationModal.tsx` (retry action) |

After republish, apply the migration, then re-run
`get_advisors(type: security)` to confirm the anon findings clear.

## Intentionally left as-is (documented, not a regression)

- **`get_shared_qa_answer()` anon EXECUTE** — powers the public share-token QA
  view; the `report-qa` edge function calls it with the anon client by design,
  and the function gates on the share token internally.
- **`resolve_report_template()` anon EXECUTE** — resolved from the browser during
  report rendering; returns non-sensitive template structure.
- **`has_role` / `has_aml_role` / `has_aml_write_role` / `has_any_aml_role`** —
  RLS predicate helpers referenced by 20–59 policies each; revoking EXECUTE would
  break policy evaluation. The advisor flags them, but they are safe read-only
  predicates.
- **`vapi_call_logs` SELECT = authenticated** — already staff-scoped (no anon).
  Cannot be narrowed further at the data layer without breaking the LiveCalls /
  CallLogs realtime subscriptions, which authenticate as `authenticated`. Module
  gating is enforced in-app and by the `get-call-logs` edge function.
- **`comparison_analysis_templates` SELECT = all authenticated** — a deliberate
  staff-shared template library (no anon exposure); writes are already
  `created_by`-scoped.

## Deferred — needs an edge-function refactor (tracked)

- **`notifications` INSERT `WITH CHECK(true)`** — authenticated-only (no anon),
  but a staff user can currently insert a notification targeted at another user.
  Legitimate cross-user notifications exist (deal/reminder assignments in
  `DealDetailView`, `ClientReminders`, `DealTrackerTab`, `useCreateClientReminder`),
  so the fix is to route inserts through an edge function that validates the
  actor may notify the target — not a blanket RLS tightening. Left unchanged to
  avoid breaking the assignment-notify feature.

## Operational — owner action in the Supabase dashboard (not code)

- **Leaked Password Protection disabled** — enable in Auth settings (HaveIBeenPwned).
- **Postgres version has security patches** — schedule the upgrade
  (project is on 17.4.1.074).
- **`extension_in_public` (`vector`, `pg_net`)** — low priority; relocating
  extensions can break dependents, so treat as accepted unless a hardening pass
  schedules it.
- **Public MCP server without auth** — infra/config outside this repo.

## Not addressed here (by-design backlog)

`rls_policy_always_true` still reports ~70 tables. The specific sensitive tables
called out by the audit are handled in RLS-C1/C2 and RLS-W1/W2; the remainder are
internal staff-only reference/cache tables where org-wide `authenticated` access
is the intended posture. Narrowing those requires per-table ownership modelling
and is out of scope for this warning-tier pass.
