# Market Updates Phase 3 — authoritative reads and RLS

Phase 3 removes the split between direct browser PostgREST reads and service-role
administration reads. The `market-updates-status` Edge Function is the authoritative,
sanitised contract for published updates, canonical source health, ingestion-run
polling, digests and operational status.

Every action verifies the human session and the deny-by-default `market_updates`
`can_view` permission before using the service role. Responses exclude provider
credentials and raw provider configuration. Operational status includes canonical
source health, archived/unresolved counts, update-state counts, recent run/fetch/
digest/cron records, active-run state, safe agent readiness and safe OpenRouter
readiness.

Apply `20260726160000_market_updates_authoritative_read_contract.sql` after the
Phase 2 registry migration. It keeps RLS enabled, revokes all direct privileges
from `public`, `anon` and `authenticated`, grants only `service_role`, removes the
legacy broad authenticated policies and installs explicit service-only policies
for all six Market Updates tables. Ordinary browser users cannot write any Market
Updates table or bypass the Edge permission contract.

The page loads published updates and operational health independently with
`Promise.allSettled`. A failed component retains its previously loaded state while
healthy components continue updating. Digest loading is also independent, so a
digest failure cannot erase source health or published updates.
