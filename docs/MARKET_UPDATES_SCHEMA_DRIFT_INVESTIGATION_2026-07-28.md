# Market Updates outage — schema drift investigation (2026-07-28)

**Symptom.** The Market Updates tab shows `Market Updates requires attention — Stage: Digest ·
Function: market-updates-digest · HTTP 500 · Retryable`, the header reads `0/0 sources live`,
every counter reads `0`, `LATEST AI MODEL` / `LATEST AI ROUTE` read `Not configured`, and no new
news items have appeared since 26 July.

**Root cause.** The nine `20260726*` Market Updates migrations exist in
`supabase/migrations/` but were never applied to the project database. The Edge Functions that
depend on them *are* deployed. Every Market Updates code path that touches a column those
migrations add now fails. This is a deploy-ordering problem, not a configuration or data problem.

## Evidence

Latest applied Market Updates migration: `20260725192749 market_updates_phase1_production_recovery`.
Never applied:

| Migration | Adds |
| --- | --- |
| `20260726150000_market_source_registry_reconciliation` | `market_sources.registry_status`, `superseded_by_source_id`, `archived_at`, `reconciliation_reason`; `market_source_reconciliation_audits` |
| `20260726160000_market_updates_authoritative_read_contract` | service-only RLS contract |
| `20260726170000_market_updates_central_llm_router` | `agent_model_assignments.is_active`; `route_used` / `provider_attempts` / `fallback_used` / `ai_latency_ms` / `ai_failure_reason` telemetry; seeds the four `market_updates_*` agent assignments |
| `20260726180000_market_updates_publication_decisions` | `market_updates.publication_reason`, `candidate_reason`, `ai_status`, `ai_failure_code`, `validation_failures`, `decisioned_at` |
| `20260726190000_market_source_refresh_cadence_minutes` | minute-resolution refresh cadence |
| `20260726200000_market_digest_deterministic_windows` | `market_digests.period_key`, `queued_at`, `started_at`, `completed_at`, `error_code`, `safe_error_message`, `update_count`, `candidate_count`, `last_published_update_at`; unique index on `(period, period_key)` |
| `20260726210000_market_updates_continuous_automation` | `market_updates_automation_runs`, `market_updates_operational_alerts`, `dispatch_market_updates_automation()`, `evaluate_market_updates_automation_alerts()`, `market_updates_automation_status()` |
| `20260726220000_market_updates_correlation_trace` | `correlation_id` on the five Market Updates tables |
| `20260726230000_market_updates_legal_storage_guardrails` | excerpt length constraints; `market_sources.legal_storage_policy` |

### 1. No news is ingested

`market-updates-ingest/index.ts:236` writes `market_ingestion_runs.correlation_id` through
`checkedMutation`, which throws on any PostgREST error. That line sits outside every `try` block
in the handler, so the function aborts immediately after acquiring the run lock. The run row is
left in `running` with `sources_considered = 0`; the next hourly run's
`acquire_market_ingestion_run` sweeps it to `failed / "Timed out before completion"`.

Even with that line fixed, `index.ts:238` filters
`market_sources.registry_status = 'canonical'`, so the source query would error and no source
would ever be selected.

Observed: every `market_ingestion_runs` row since 2026-07-26 has `sources_considered = 0` and
`error_summary = 'Timed out before completion'`. Last successful source fetch:
**2026-07-26 06:07 UTC**.

### 2. The digest button returns HTTP 500

`market-updates-digest/index.ts:150` filters `market_digests.period_key`. The column is missing,
so `existingError` is set and the handler returns `digest_state_failed` with status 500 at
`index.ts:151` — before any provider call. The banner marks it retryable, but no retry can
succeed. The same key drives `upsert(..., { onConflict: 'period,period_key' })` at lines 165,
194, 199 and 250; the live unique index is still `(period, period_start)`.

Edge logs show repeated `POST | 500 | .../market-updates-digest`.

### 3. The header reads 0/0 and "Not configured"

`market-updates-status/index.ts` selects `market_sources.registry_status` and
`legal_storage_policy` (lines 12, 87, 104, 124-125), `market_updates.correlation_id` /
`publication_reason` / `candidate_reason` / `ai_status` (line 11),
`agent_model_assignments.is_active` (line 109), and calls the RPC
`market_updates_automation_status()` (line 112), which does not exist. The `sources` and `status`
actions throw into the catch at line 160 and return 500; the UI degrades those to zeros rather
than surfacing the failure.

The underlying data is intact: 45 sources (all 20 approved canonical keys present, 13 enabled and
healthy), 354 `market_updates` rows (33 published, 26 candidate), 19 digests, 68 ingestion runs.

## Resolution

All nine migrations plus `20260728063000_market_updates_automation_dispatch_hardening` were
applied to the project on 2026-07-28. Post-apply state:

- `market_sources`: 20 canonical (13 enabled), 25 unresolved legacy, all carrying
  `legal_storage_policy`.
- `market_digests`: all 19 rows keyed; unique index on `(period, period_key)` live.
- `agent_model_assignments`: four active `market_updates_*` assignments.
- `market_updates_automation_status()` resolves; 9 `market-updates-%` cron jobs scheduled.

A verification ingestion run (`trigger_type = 'cron'`) completed in 28s: 13 sources considered,
7 succeeded, **184 items discovered, 6 published, 15 candidates** — the first published items
since 26 July. Its post-run trigger then generated the `24h:2026-07-28T00:00:00.000Z` digest,
which is `published` with `update_count = 6` via `openrouter`.

### Applying the fix (for reference / other environments)

Apply the nine migrations in filename order. Before applying `20260726210000`, note two hazards
addressed by `20260728063000_market_updates_automation_dispatch_hardening`:

- **Missing vault secret.** `dispatch_market_updates_automation()` as originally written requires
  vault entries `supabase_url` *and* `market_ingestion_cron_secret`. This project has only
  `supabase_url`; `app.market_ingestion_cron_secret` is not set as a database setting either.
  Every dispatch would record `failed / required_vault_secret_missing` and never call the
  function. The follow-up migration falls back to `cron_signed_internal_headers()` — the signed
  envelope backed by `internal_edge_secret`, which is what the current Market Updates cron jobs
  already use successfully.
- **Dropped cron job.** `20260726210000` runs
  `cron.unschedule(jobid) from cron.job where jobname like 'market-updates-%'`, which also
  removes `market-updates-embed-backfill-hourly` and never recreates it. The follow-up migration
  restores it.

Apply `20260728063000_market_updates_automation_dispatch_hardening` immediately after
`20260726210000`, or at the end of the backlog — it is idempotent either way.

### Verification after applying

```sql
-- schema drift resolved
select count(*) from market_sources where registry_status = 'canonical';         -- expect 20
select count(*) from market_digests where period_key is not null;                -- expect 19
select to_regproc('public.market_updates_automation_status');                     -- non-null

-- ingestion recovers on the next hourly run (or trigger Sync Latest News)
select status, sources_considered, items_published, error_summary
from market_ingestion_runs order by started_at desc limit 3;                      -- sources_considered > 0

-- cron intact
select jobname, schedule from cron.job where jobname like 'market-updates-%';     -- 9 jobs
```

Then use **Refresh View** in the UI: the header should report live source counts and the digest
route, and **Generate 24 Hours Digest** should return 200.

## Outstanding items

These are separate from the outage and were not introduced by it.

### 1. Mirror `MARKET_INGESTION_CRON_SECRET` into Vault (ops action)

`market-updates-digest` accepts only a matching `x-cron-secret` header or an interactive Bearer
token; it rejects the signed internal-header envelope with `401 unauthorized`. Because
`market_ingestion_cron_secret` is absent from Vault, the scheduled **weekly / bi-weekly / monthly /
quarterly / annual** digest jobs cannot authenticate. This predates the outage — the previous cron
command also sent an empty `x-cron-secret` — and `market_updates_automation_status()` now reports
it honestly as `required_secrets_present: false`, which surfaces the `automation_secrets_missing`
warning to admins.

The 24-hour digest is unaffected: `market-updates-ingest` triggers it directly after any run that
publishes, using its own `MARKET_INGESTION_CRON_SECRET` environment variable.

Fix: copy the `MARKET_INGESTION_CRON_SECRET` value already configured on the Edge Functions into
Vault under the name `market_ingestion_cron_secret`. `dispatch_market_updates_automation()` prefers
it as soon as it exists, with no further code change.

```sql
select vault.create_secret('<same value as the Edge Function env var>', 'market_ingestion_cron_secret');
```

### 2. Six source adapters yielding no metadata — resolved

Fixed in `20260728071500_market_source_adapter_repair` and the accompanying
`adapters/htmlListing.ts` change. Details in the next section. Five further canonical sources
(AFCA, Property Council, Banking Code Compliance Committee, Reuters, Domain) remain disabled
because their origins require a licensed feed.

## Source adapter repair

The six sources that reported `Listing layout yielded no public article metadata` were not
suffering from stale selectors. Two independent defects were responsible.

### Defect A — every configured anchor pattern was rejected as unsafe

`compileAnchorPatterns` (`adapters/anchorPatterns.ts`) silently drops any pattern that fails
`isSafeAnchorPattern`, which enforces three rules: at most 128 characters, at most one unbounded
quantifier (`+`, `*`, `{n,}`), and no lookarounds. Every seeded pattern broke at least one:

| Source | Length | Unbounded quantifiers | Lookaround | Verdict |
| --- | --- | --- | --- | --- |
| The Adviser / Broker Daily | 139 | 2 (`\d+`, `[a-z0-9-]+`) | no | rejected |
| Mortgage Professional Australia | 30 / 41 | 2 / 3 (`[^/]+`, `[0-9]+`) | no | rejected |
| FBAA | 276 | 1 | `(?!…)` | rejected |

With no compiled pattern the anchor fallback could not run, and because these listings are
client-rendered (zero `<article>` elements, no article-typed JSON-LD) the earlier extraction
steps had nothing to work with either.

### Defect B — `safeSourceExcerpt` was used but never imported

`adapters/htmlListing.ts` called `safeSourceExcerpt` at lines 43 and 75 without importing it from
`./security.ts`. Both call sites sit inside `try { … } catch { }` blocks that swallow the
resulting `ReferenceError`, so **JSON-LD extraction (step 1) and the configured selector sweep
(step 2) discarded every item they built, for every `html_listing` source**. Only the anchor
pattern and sitemap fallbacks could ever produce results. The missing import is now added.

### Replacements

All patterns and endpoints below were validated on 2026-07-28 against live markup using a
faithful port of the adapter's own parsing and pattern-safety code.

| Source | Change | Verified yield |
| --- | --- | --- |
| ABC News Business | → `rss`, feed `/news/feed/51892/rss.xml` | 25 items, all dated |
| MFAA | → `rss`, feed `/feed` | 12 items, all dated |
| Mortgage Professional Australia | → `rss_with_html_fallback`, feed `/au/rss`; fallback pattern `^/au/[a-z0-9/-]{10,90}/[0-9]{4,8}$` (no unbounded quantifier — bounded `{n,m}` is not counted) | 36 via feed, 7 via fallback |
| The Adviser | pattern `^/(lender\|…\|aggregator)/[0-9]{3,8}-[a-z0-9-]+$` (114 chars, 1 unbounded); listing URLs reordered richest-first | 20 items |
| Broker Daily | same pattern; `primary_url` corrected off the dead `/feed/`; listing URLs reordered | 15 items |
| FBAA | disabled | — |

`HtmlListingAdapter.fetch` returns on the first listing URL that yields items rather than
aggregating, so listing URLs are ordered richest-first (`/breaking-news` for both Momentum Media
titles).

FBAA is disabled rather than repaired: its newshub publishes no first-party articles. Every
headline links to a third-party outlet — theadviser.com.au, brokerdaily.au, mpamag.com,
brokernews.com.au and roughly twenty others — which `normaliseUrl` rejects as a disallowed source
domain, and its sitemap contains only navigation pages. The outlets it aggregates are already
canonical sources in their own right.

### Result

The first hourly cron run after the repair: **12/12 sources succeeded, 0 failed, 263 items
discovered, 7 published** (previously 7/13 succeeded, 184 discovered). All five repaired sources
report `health_status = 'healthy'` with `consecutive_failures = 0`.

The `htmlListing.ts` changes (the missing import, plus a distinct error message when every
configured anchor pattern is rejected) take effect on the next deployment of
`market-updates-ingest`; the source configuration changes were live immediately.
