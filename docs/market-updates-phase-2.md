# Market Updates Phase 2

## Canonical registry reconciliation (2026-07-26)

Apply `20260726150000_market_source_registry_reconciliation.sql` after the Phase 1
recovery migration. It marks the approved 20 stable `source_key` rows as
canonical, deterministically matches legacy records by key, normalised URL or
normalised name, reassigns update and fetch-run references, and archives matched
legacy records without deleting history. Ambiguous or unmatched rows are retained,
disabled and marked `unresolved_legacy` for manual review.

The migration is additive and repeatable. Its single audit record reports starting,
canonical, matched, merged, archived and unresolved counts plus reassigned reference
counts. Source Admin displays canonical sources by default and provides separate
Needs review and Archived views; ordinary source operations remain restricted to
canonical rows.

## Purpose
Market Updates is a source-backed Australian property market intelligence workspace for finance, property market, construction/supply, rental, policy/regulation and economic updates. It never displays fake news: cards, KPIs, digests and Q&A are derived from persisted Supabase records.

## Tables
Run `supabase/migrations/20260703000000_market_updates_phase_2.sql` to create `market_sources`, `market_updates`, `market_digests` and `market_update_questions` with indexes and RLS.

## Edge Functions
- `market-updates-ingest`: protected ingestion from enabled `market_sources`.
- `market-updates-digest`: protected 24-hour digest from published stored updates.
- `market-updates-qa`: authenticated, source-grounded Q&A from published stored updates only.

## Environment variables
- `MARKET_INGESTION_CRON_SECRET` for cron/admin execution.
- `MARKET_RELEVANCE_THRESHOLD` defaults to `60`.
- `MARKET_AI_MODEL` for future source-grounded summarisation model selection.
- `MARKET_NEWS_API_KEY` if a licensed news API adapter is configured.
- `MARKET_DATA_API_KEY` if a licensed property data adapter is configured.
- AI provider key following existing repo conventions, e.g. `OPENAI_API_KEY`, only in Supabase Edge Functions.
- Supabase function runtime variables: `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.

## Seeding sources
Seed disabled candidates from `src/services/marketUpdates/sourceSeeds.ts`. Keep sources disabled until licensing, usage terms and feed quality are verified. Example: insert rows into `market_sources` with `enabled = false`, review, then enable.

## Manual ingestion
Call `market-updates-ingest` with `x-cron-secret: $MARKET_INGESTION_CRON_SECRET` and optional body `{ "force": true }`. The function loads enabled sources, respects `refresh_frequency_hours` unless forced, normalises feed items, deduplicates, scores relevance, classifies, and stores rows.

## Digest generation
Call `market-updates-digest` after ingestion using an authenticated session or cron secret. It queries published updates from the last 24 hours and writes one `market_digests` row. If no records exist it returns the truthful no-data response.

## Q&A testing
Call `market-updates-qa` as an authenticated user with `{ "question": "...", "updateIds": ["optional-id"] }`. It refuses unsupported questions with: “I do not have enough sourced market updates to answer that yet.”

## Daily automation
Schedule `market-updates-ingest` every 24 hours, then schedule `market-updates-digest` after ingestion. The page reads the latest digest and published updates on load.

## Security
No service-role key, AI key or private data provider key is used in the browser. Ingestion and digest are protected. Q&A requires authentication. Public unauthenticated writes are blocked by RLS.

## Copyright and citations
Store short excerpts and metadata only unless licensed. Published updates require source URLs and citations. Summaries must be concise, transformative and grounded in supplied source material.

## Known limitations
RSS support intentionally limits items and does not scrape full article pages. API and partner-feed adapters require licensed server-side configuration. Model/API usage logging should be wired into the project-wide metering pipeline when market operations are enabled in production.
