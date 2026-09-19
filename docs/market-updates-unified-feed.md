# Market Updates unified intelligence deployment

## Audit
The original implementation stored three disabled seed entries, fetched only RSS with regular expressions, used a short FNV hash, had no run ledger/single-flight lock, and rendered digest content before the update feed. Authentication was already hardened with verified JWT/admin checks, CSRF enforcement and service-role isolation; those controls remain in place.

## Deploy
```sh
supabase db push
supabase functions deploy market-updates-ingest
supabase functions deploy market-updates-digest
supabase functions deploy market-updates-source-admin
supabase functions deploy market-updates-feed
```

Set Edge Function secrets with `supabase secrets set`: `MARKET_INGESTION_CRON_SECRET`, `MARKET_AI_MODEL`, `MARKET_RELEVANCE_THRESHOLD`, `MARKET_AI_CONFIDENCE_THRESHOLD`, `MARKET_UPDATES_STALE_MINUTES` (default 60), `MARKET_UPDATES_SOURCE_TIMEOUT_MS` (15000), `MARKET_UPDATES_RUN_TIMEOUT_MS` (180000), `MARKET_UPDATES_MAX_RESPONSE_BYTES` (3000000), `MARKET_UPDATES_MAX_CONCURRENCY` (4), `MARKET_UPDATES_MAX_ITEMS_PER_SOURCE` (40), `MARKET_UPDATES_INITIAL_BACKFILL_DAYS` (7), `MARKET_UPDATES_USER_AGENT`, and `MARKET_UPDATES_ROUTE_URL`. Existing `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `LOVABLE_API_KEY` remain required and server-only.

The idempotent migration creates an hourly pg_cron job at minute 5. Configure `app.settings.supabase_url` and `app.settings.market_ingestion_cron_secret` using the project's protected secret/bootstrap process; do not store the secret in a source row. New published items request a grounded 24-hour digest refresh.

## Unified RSS
Authenticated endpoint: `https://<project>.supabase.co/functions/v1/market-updates-feed`. Supported parameters are `segment`, `category`, `impact`, `source`, `geography`, `since`, and `limit` (maximum 100). It returns metadata and transformative summaries only.

## Source validation status
Network validation was blocked in the implementation environment, so no candidate is labelled operational without a deployment-time GET validation. Configured native-feed candidates: realestate.com.au, Domain, Broker Daily, Guardian Australia, Parliament, Australian Banking Association, AUSTRAC, and Allens. Each is GET/XML/entry validated by `RssAtomAdapter`; hybrid candidates fall back to static HTML metadata and record degraded health. Cotality, ABC, Reuters, Urban Developer, MPA, Property Council, The Adviser, MFAA, AFCA, Banking Code Committee, and FBAA use controlled HTML metadata adapters. The Federal Register uses the official API registry entry; its OpenAPI document must be reviewed and documented OData resources placed in `adapter_config` before enabling API ingestion. Reuters requires a commercial licence for anything beyond link/listing metadata; licensed partner adapters remain fail-closed until credentials and terms approval are configured.
