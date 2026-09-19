# Market Updates Phase 14 — deployment gate and live acceptance record

**Attempt date:** 2026-07-26  
**Approved project:** `dduzbchuswwbefdunfct`  
**Repository commit before this phase:** `536379e`

## Release state

The repository is linked to the approved project in `supabase/config.toml` and `supabase/.temp/linked-project.json`. This execution environment has no Supabase CLI, `SUPABASE_ACCESS_TOKEN`, database credential, service-role credential, application test identity or provider credential. Secret-name presence cannot be inferred from `.env.example`. Installing the CLI with `npx --yes supabase@latest --version` was attempted and rejected by the environment's npm proxy with HTTP 403. A TLS health request to the linked Supabase host was also rejected by the environment proxy before reaching Supabase.

Consequently, **no production mutation was performed**: migrations were not applied, functions were not deployed, secrets were not changed, cron was not changed, and controlled ingestion/digest/Q&A calls were not made. Production repair and the 45-step live acceptance sequence remain unverified. This is a hard evidence boundary, not a success claim.

## Deployment package

`scripts/deploy-market-updates-phase14.sh` is the authorised, fail-closed deployment entrypoint. It verifies the exact linked project, requires the CLI and access-token name without printing its value, runs the Phase 13 and static-security gates, displays migration state, then requires an explicit project-specific confirmation before applying migrations. It deploys exactly the six Market Updates functions requested by the implementation prompt and prints post-deployment migration, function and secret-name inventories.

The script intentionally stops before declaring production acceptance. An authorised operator must attach sanitised evidence for migration history, function versions/logs, required secret names, Model Hub/OpenRouter assignments, cron jobs/history, controlled source test/full ingestion, published/candidate persistence, all digest periods, grounded Q&A citations, RSS/ETag behaviour, RLS denials, provider fallback, partial source/digest failure and cached frontend state.

## Required operator sequence

1. Install an approved Supabase CLI version and export `SUPABASE_ACCESS_TOKEN` through the secure runner.
2. Review `supabase migration list --linked` against the nine Phase 2–12 migrations.
3. Set `MARKET_UPDATES_DEPLOY_CONFIRM=DEPLOY_dduzbchuswwbefdunfct` only after that review.
4. Run `scripts/deploy-market-updates-phase14.sh` from a clean, reviewed commit.
5. Verify required secret **names only**: `OPENROUTER_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `MARKET_INGESTION_CRON_SECRET`, and `APP_URL` where required.
6. Execute the master prompt's full 45-step live acceptance sequence with an authorised application identity and retain sanitised correlation IDs, counts and timestamps.
7. Do not merge or report production recovery until every mandatory acceptance item either passes or has an explicitly approved exception.

## Rollback

Stop/unschedule the new Market automation jobs first, then redeploy the previously attested function versions. The migrations are additive and preserve historical records; do not blindly reverse or delete reconciled source/update/fetch-run references. Database rollback must use a separately reviewed forward migration that preserves audit history and restores prior grants/policies where required. Rotate any credential if execution logs ever expose it; this repository package emits no credential values.
