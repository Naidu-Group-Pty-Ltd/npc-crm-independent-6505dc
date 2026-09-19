# Market Updates Phase 1 — production contract and deployment audit

**Audit date:** 2026-07-26
**Scope:** Phase 1 only (inspection and evidence; no runtime/schema/UI changes)
**Repository revision inspected:** `2873840` on the supplied `work` branch
**Linked Supabase project:** `dduzbchuswwbefdunfct`

## 1. Evidence boundary and handling

This note separates **repository-confirmed**, **screenshot-observed**, and
**production-unverified** facts. It intentionally contains no credential value,
session token, JWT, database password, provider key, or raw article body.

The repository link (`supabase/config.toml` and
`supabase/.temp/linked-project.json`) consistently names project
`dduzbchuswwbefdunfct`. The execution environment did not provide the Supabase
CLI, a Supabase access token, database credentials, a service-role credential,
an application login, or a production application URL. A direct TLS request to
the linked Supabase host was attempted, but the environment proxy rejected the
CONNECT request with HTTP 403 before Supabase was reached. Therefore no claim is
made that a migration was applied, a function was deployed, a secret exists, a
cron job ran, or production was repaired.

The supplied screenshots are accepted as point-in-time UI evidence. They show:

- the main page reporting `Configured 0`, `Enabled 0`, `Healthy 0`, no run and no
  digest;
- a Digest-stage reachability alert naming `market-updates-digest`;
- Source Admin reporting `13/45 enabled`, healthy source rows, and an example
  source fetch discovering 40 items but publishing 0; and
- Latest Updates reporting 0 published updates while incorrectly presenting a
  filter-exclusion empty state.

Those screenshots do not expose migration history, function versions/logs,
secret inventory, provider attempts, cron rows, or complete database counts, so
they cannot establish those facts.

## 2. Required production inventory

| Audit item | Production finding | Evidence / disposition |
|---|---|---|
| Applied migrations | **Unverified** | Requires authorised SQL or `supabase migration list --linked`. Repository contains both required migrations. |
| Missing migrations | **Unverified** | The 45-row source view suggests legacy and canonical rows coexist, but does not prove which migration versions ran. |
| Deployed function versions | **Unverified** | No Management API/CLI access. Repository artifact fingerprints are recorded below for later comparison. |
| Missing deployments | **Unverified** | The screenshot proves a Digest-stage HTTP failure, not whether it was a missing deployment, CORS/gateway rejection, auth failure, timeout, or network failure. Source Admin returning rows is evidence that its request path worked at screenshot time, not a version attestation. |
| Present secret names | **Unverified** | Secret names cannot be enumerated safely without authorised Management API/CLI access. |
| Missing secret names | **Unverified** | Required contract is `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `MARKET_INGESTION_CRON_SECRET`, `OPENROUTER_API_KEY`, and `APP_URL` where used. Current Market functions additionally require `LOVABLE_API_KEY`; this conflicts with the target architecture. |
| RLS failures | **Unverified in production** | Browser screenshot is consistent with direct-read failure, but provides no HTTP status or PostgREST error. Repository policies/grants are reviewed in section 5. |
| Function HTTP failures | **Observed, not classified** | Screenshot: Digest stage, `market-updates-digest`, “service could not be reached.” No HTTP status/correlation ID was captured. |
| Provider failures | **Unverified in production** | No function logs or Model Hub test result. Repository functions bypass Model Hub and call Lovable directly. |
| Source registry | **Observed: 45 total / 13 enabled** | Screenshot only. Repository canonical registry contains 20 stable keys and recovery SQL would leave 19 enabled. Canonical/legacy breakdown is unavailable. |
| Update counts | **Observed: 0 published; candidate/ignored unknown** | The UI shows 0 published. It does not show authoritative candidate or ignored counts. |
| Recent ingestion runs | **UI shows no successful run** | Exact rows/status/errors/durations are unverified. Source rows nevertheless contain fetch telemetry, showing the two UI contracts disagree. |
| Recent source fetches | **Partially observed** | Source Admin shows healthy HTTP 200 rows and one example with 40 discovered / 0 published. Complete run rows are unverified. |
| Recent digest results | **UI shows no digest** | Database rows and function logs are unverified. |
| Cron status | **Unverified** | Repository defines only guarded hourly ingestion scheduling; existence and run history in production are unknown. |
| Market agent assignments | **Unverified in production** | No authorised database access. Required `market_updates_*` assignments are not seeded by the inspected Market migrations. |
| OpenRouter status | **Unverified in production** | Shared router support exists, but the three Market AI functions do not use it. |

### Repository function fingerprints

These SHA-256 values identify the inspected repository artifacts; they are **not**
deployed version claims:

| Function/artifact | SHA-256 |
|---|---|
| `market-updates-ingest/index.ts` | `09ae3d796b1e42ddae321d1a710d944ad8bf7d9f1cf48a7cf774fc7b92ce7750` |
| `market-updates-digest/index.ts` | `9d08a219eddbb86badce0f0c9f3eff5354ed2c7260ef2717d9a5fe1a14bb9c59` |
| `market-updates-qa/index.ts` | `9fb2205b8b2de9acb92796fe508f16d0c396acd564a4549823ea24324761e17d` |
| `market-updates-source-admin/index.ts` | `e35e28dd6d861e4d7cf3c58d473e0e26cd56fdea5b46d7e0adbb32380d0ed582` |
| `market-updates-feed/index.ts` | `393569b4c8e76a755ae764c4030e41e88ebf891a661f8dc448913d7233eaf01f` |
| `_shared/llmRouter.ts` | `856c204a8f346d09a7b3f96dde2d31c5f2708c0e52692f446cb5df720b47b358` |

## 3. Repository contract inspected

The audit covered all files named in the Phase 1 prompt, the RSS/Atom and HTML
adapters, SSRF/security helpers, shared authentication/authorisation/CSRF/request
security, all migrations referencing the six Market tables, the Model Hub router
and management function, and the frontend page/service/types/admin dialog.

The repository canonical registry has 20 stable keys. The recovery migration
upserts by `source_key`, preserves health columns, disables the unconfigured
Federal Register adapter, and would therefore result in 19 enabled canonical
sources if applied to an otherwise compatible database. It does **not** reconcile
the 25 apparent excess rows shown in production by URL/name, reassign references,
archive legacy rows, or identify unresolved rows. That belongs to Phase 2.

The configured Edge Function contract sets `verify_jwt = false` for ingest,
digest, Q&A, source-admin and feed so authentication can be enforced inside each
function. Repository security helpers provide exact-origin cookie CSRF checks,
deny-by-default module authorisation, safe generic errors, request size limits,
signed internal calls, and rate limiting. No change to those controls is made in
this phase.

## 4. Confirmed repository root causes and contract gaps

1. **Market AI bypasses the central router.** Ingest, digest and Q&A read
   `LOVABLE_API_KEY` and call `https://ai.gateway.lovable.dev/v1/chat/completions`
   directly. They do not call `_shared/llmRouter.ts`, cannot use the active
   OpenRouter assignment/fallback chain, and cannot report shared provider
   telemetry. Model Hub therefore cannot make the Market pipeline operational.

2. **Agent keys are inconsistent.** The page displays `market_qa` and
   `market_digest`, while the requested production contract uses
   `market_updates_classifier`, `market_updates_digest`,
   `market_updates_qa_fast`, and `market_updates_qa_deep`. No inspected Market
   migration seeds those four assignments.

3. **The frontend has an all-or-nothing read path.** Initial loading and reload
   each combine direct `market_updates`/`market_sources` reads and health loading
   in one `Promise.all`. One rejected direct read prevents all three state updates.
   Digest is loaded separately, but a common operational alert is overwritten by
   whichever request finishes last. This explains how a populated admin endpoint
   can coexist with zero main-page state.

4. **There is no authoritative status endpoint.** Published updates, digests,
   sources, and ingestion runs are read directly under authenticated RLS, while
   source administration is read through a service-role Edge Function. Counts
   therefore come from different access contracts and cannot be reconciled.

5. **Persistence errors are counted as success.** Ingestion awaits update inserts
   but does not inspect their returned `error`; it then increments ingested,
   published/candidate/ignored and source-success counters. Fetch-run, source
   health, and final ingestion-run update errors are also ignored. A constraint,
   enum, RLS, or schema mismatch can consequently produce “items found / 0
   published” or false success telemetry without a controlled database failure.

6. **The fallback cannot publish under defaults.** When direct Lovable AI is
   unavailable, heuristic classification is assigned confidence 40. The default
   publication threshold is 55, so every otherwise relevant fallback item becomes
   a candidate. Candidate counts/reasons are not exposed by the present page.

7. **Legacy registry rows are not reconciled.** The canonical migration only
   conflicts on non-null `source_key`. Legacy rows without the stable key remain,
   matching the screenshot symptom of 45 displayed rows versus 20 approved keys.

8. **Refresh cadence has two authorities.** Ingestion prefers
   `refresh_frequency_minutes`; Source Admin edits
   `refresh_frequency_hours`. An admin save can therefore leave actual freshness
   eligibility unchanged.

9. **Digest windows are not canonical.** Each period is calculated backward from
   the request timestamp, and `(period, period_start)` is the unique key. Repeated
   calls at different instants create different keys instead of one daily/weekly/
   monthly bucket.

10. **Post-ingestion digest generation is not durable.** Ingestion launches an
    unawaited `fetch` and immediately returns. The Edge runtime may terminate it,
    leaving no queued job or followable status.

11. **Automation is incomplete.** Market migrations conditionally schedule only
    `market-updates-hourly`. There are no repository schedules for all requested
    digest periods, no status heartbeat contract, and no verified production job.

12. **The empty state is logically wrong.** When both the published collection and
    filtered collection are empty, the page enters the “filters hide updates”
    branch even with default filters, matching the supplied screenshot.

13. **Operational diagnostics are too lossy.** The service maps many failures to a
    safe generic issue but does not consistently retain server correlation IDs or
    distinguish provider configuration/payment/rate-limit/timeout, cron, parse,
    and persistence classes required by the master contract.

## 5. Migration, RLS, and grant chronology

- `20260703000000_market_updates_phase_2.sql` and the July 6 migrations create the
  base tables, broad authenticated read policies, initial sources, periods,
  conversation fields, search/embedding additions, and Q&A support.
- `20260721150000_security_phase7_lock_remaining_service_tables.sql` revokes all
  authenticated access to `market_update_questions`.
- `20260725010000_market_updates_unified_intelligence.sql` adds the richer source/
  update contract, ingestion/fetch runs, canonical seeds, read grants, single-
  flight RPC, and initial hourly cron definition.
- `20260725101000_secure_market_qa_conversation_anchors.sql` removes authenticated
  question insertion and scopes question reads to their owner.
- `20260725130000_market_updates_phase1_production_recovery.sql` additively repeats
  the runtime contract, 20-key registry, RLS/grants, lock, health preservation,
  Federal Register disablement, and guarded hourly scheduling.
- `20260725201126_*` and `20260726044018_*` re-grant authenticated SELECT on Market
  tables (and the former re-grants question INSERT), creating a chronology that
  must be verified against the intended owner-only Q&A hardening in production.

Repository RLS is enabled on all six required tables. Ordinary authenticated users
have no intended table writes to sources, updates, digests, or run tables, but
direct table SELECT policies are broad and do not enforce the `market_updates`
module permission. The service-role functions do enforce module/admin gates. This
split is a confirmed contract inconsistency; actual production grants/policies and
any `42501` failures remain unverified.

## 6. Phase gate and authorised follow-up

Phase 1 stops at audit evidence. No migration, function deployment, secret change,
cron mutation, provider test, ingestion, digest, Q&A call, or UI change was made.

Before Phase 2 implementation, an authorised production operator must capture:

1. linked migration history and schema/grant/policy definitions for all six Market
   tables;
2. deployed function list, version, import map, JWT setting, and recent logs for
   all five required functions;
3. secret **names only** for the required contract;
4. sanitised SQL counts grouped by registry status, enabled/health/update status,
   plus recent ingestion/fetch/digest rows;
5. active Market agent assignments and OpenRouter provider health/test results;
6. `cron.job` definitions and sanitised `cron.job_run_details` history; and
7. authenticated browser Network/Console evidence with HTTP status and safe
   correlation IDs for each failed request.

Until that evidence is attached, applied/missing migrations, deployed/missing
functions, secret readiness, provider readiness, authoritative counts, RLS
behaviour and cron health must remain labelled **unverified**, not inferred.
