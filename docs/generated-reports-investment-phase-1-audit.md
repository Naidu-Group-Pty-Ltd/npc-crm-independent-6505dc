# Generated Reports investment retrieval remediation — Phase 1 audit

**Audit date:** 2026-07-26  
**Phase gate:** Phase 1 — reproduce and identify the exact error  
**Linked Supabase project:** `dduzbchuswwbefdunfct` (`NPC Property Dashboard`)

## Scope and result

This phase inspected the investment library path from `GeneratedReports.tsx` through
`invokeSecureFunction`, `get-investment-reports`, PostgREST projections, generated
Supabase types, migrations, and client-side package grouping. It intentionally makes
no database, Edge Function, or UI behavior changes.

The repository contains a deterministic failure path matching the supplied production
evidence:

1. Both the active and archived library requests select
   `investment_reports.canonical_property_key`.
2. The Edge Function accepts that caller-controlled projection and passes it unchanged
   to PostgREST.
3. A PostgREST projection error is collapsed by the function to HTTP 500 with
   `error: "Failed to fetch reports"`; the frontend displays that value in its
   destructive toast.
4. The frontend returns without changing its initially empty report array, then renders
   the successful-empty state and zero counters. Thus a database error is presented as
   both an error toast and “No investment reports yet”.

The canonical-key migration exists in source, but the checked-in generated database
types do **not** contain `canonical_property_key` in the `investment_reports` Row,
Insert, or Update contract. This is direct evidence of repository/schema contract
drift and is consistent with the migration not having been applied when the types were
last generated. It is not, by itself, proof of the current live schema.

## Root-cause determination

### Confirmed from repository and supplied production evidence

The immediate application defect is an **unversioned, caller-owned list projection
coupled to lossy error handling**. A missing projected column causes the entire
investment query to fail; the Edge Function reduces the database error to the generic
message seen in the screenshot; and the UI mistakes its untouched initial `[]` for an
authoritative successful empty result.

The leading database cause is migration drift for
`20260724100000_canonical_generated_report_property_identity.sql`. Evidence:

- the frontend and Edge Function both require `canonical_property_key`;
- the additive migration is the only migration that creates it; and
- generated Supabase types omit it while containing the other requested fields.

### Live confirmation blocked in this execution environment

The production-specific statement “the linked database is missing
`canonical_property_key`” remains **unconfirmed**. The environment has the linked
project metadata but no Supabase CLI, management access token, staff browser session,
or database credential. A read-only REST/schema probe was attempted and failed during
DNS resolution with `EAI_AGAIN dduzbchuswwbefdunfct.supabase.co`. Consequently, this
phase could not retrieve:

- the deployed function bundle/version or recent logs;
- the failed authenticated browser response and its exact `details` value;
- live table columns, row/status distributions, or filters affecting rows;
- live migration history, trigger/index/function presence, or schema-cache state.

No migration or deployment should be reported as applied until an authorized operator
runs the live verification below against project `dduzbchuswwbefdunfct`.

## Path trace

| Layer | Finding | Consequence |
| --- | --- | --- |
| Frontend request | Active and archived calls send arbitrary `listOptions.select`, including `canonical_property_key`, and request `limit: 2000`. | Frontend deployment is tightly coupled to a live column and assumes a result size the server does not honor. |
| Initial effects | Mount invokes `fetchInvestmentReports()` in the combined loader and again in the date-range effect. | Two concurrent initial requests and potentially two toasts. |
| Frontend state | One page-wide `loading` flag and an initially empty report array represent success, failure, and refresh. Failure returns without an error state. | False zero counters and false empty state after an investment failure; `Promise.all` also rejects as a unit if a fetch throws. |
| Secure invocation | Adds auth/cookies, a request correlation header, a 60-second abort timeout, and one auth-refresh retry. | Transport has a correlation ID, but the current Edge Function neither returns nor logs it as a request identifier. Caller cancellation cannot currently be supplied. |
| Edge authentication | `verify_jwt = true` and `verifyAuth` are enabled. | Authentication is preserved, but no `generated_reports` module permission check is present in this function. Service-role reads are therefore available to any actor accepted by `verifyAuth`. |
| Edge projection | Caller `select` is passed directly to Supabase/PostgREST. | Missing columns or malformed selects become runtime failures; list/detail field boundaries are client controlled. |
| Edge errors | PostgREST list errors return HTTP 500 `{ error: "Failed to fetch reports", details: reportError.message }`. | The exact database error exists in `details` on the network response but is discarded by the frontend toast; errors are not classified. |
| Filtering | Active uses `eq('is_archived', false)`; non-client correctly includes null; status is restricted to four values. | Legacy null archive values are excluded, and unknown legacy statuses are excluded. Production distributions must be inspected before changing this. |
| Pagination | Edge caps every list at 200 despite the frontend requesting 2,000; React later paginates grouped records. | Libraries truncate silently and individual-report pagination can split package siblings. |
| Grouping | `buildGeneratedReportGroups` prefers `canonical_property_key`, then listing ID, client property ID, and a conservative address key. Five variants are ordered together. | Canonical grouping intent is present and must not be removed; fallback supports rolling compatibility but cannot replace migration repair. |
| Generated types | All requested lightweight columns are present except `canonical_property_key`. | Checked-in types demonstrate contract drift and do not validate the new projection. |

## Requested column inventory (repository contract)

| Column | Generated type | Migration/source evidence | Live state |
| --- | --- | --- | --- |
| `id` | Present | Base table | Not verified |
| `property_address` | Present | Base table | Not verified |
| `property_listing_id` | Present | Base table | Not verified |
| `client_property_id` | Present | 20260119000509 | Not verified |
| `canonical_property_key` | **Absent** | 20260724100000 only | **Suspected missing; not verified** |
| `created_at` | Present | Base table | Not verified |
| `current_version` | Present | 20251126092027 | Not verified |
| `report_scope` | Present | 20251202075205 | Not verified |
| `report_tier` | Present | 20251222091718 | Not verified |
| `parent_report_id` | Present | 20251222091718 | Not verified |
| `status` | Present | 20251114083359 | Not verified |
| `is_archived` | Present | 20251226032544 | Not verified |
| `is_client_report` | Present | 20260119000509 | Not verified |
| `report_variant` | Present | 20260605045728 | Not verified |
| `derived_from_report_id` | Present | 20260605045728 | Not verified |
| `investment_score` | Present | 20250929180443 | Not verified |
| `generated_by` | Present | Base table | Not verified |

## Live verification required before Phase 2

Using an authorized Supabase management/SQL session for the linked project:

1. Capture the failed request response body and confirm the PostgREST `details`,
   `code`, and HTTP status.
2. Record the deployed `get-investment-reports` version and correlated recent logs.
3. Query `information_schema.columns` for every field in the inventory above.
4. Query `supabase_migrations.schema_migrations` for version `20260724100000`.
5. Verify the canonical function overloads, trigger, partial index, and PostgREST
   schema cache.
6. Record total rows; canonical null/non-null rows; duplicate groups; orphaned
   derivatives; variants; statuses; archive values; client-report values; and rows
   excluded by each current filter.
7. Save redacted network/log/query evidence. Do not include access tokens, cookies,
   service-role credentials, report content, or personal/financial payloads.

## Phase gate

Phase 1 repository diagnosis is complete. Live production confirmation is an explicit
prerequisite for Phase 2. The next phase may add an idempotent recovery migration only
after the linked environment confirms which canonical identity objects are absent.

