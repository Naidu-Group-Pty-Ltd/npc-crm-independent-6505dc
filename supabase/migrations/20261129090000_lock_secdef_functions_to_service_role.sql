-- Two SECURITY DEFINER functions shipped executable by `anon`. This closes them.
--
-- ## What was measured
--
-- Read from the live catalogue on 2026-09-16, minutes after 20261128090000
-- applied:
--
--   geocode_cache_touch   postgres=X | anon=X | authenticated=X | service_role=X
--   market_sales_refresh  postgres=X | anon=X | authenticated=X | service_role=X
--
-- Both migrations said `revoke all on function ... from public;` and both
-- revokes SUCCEEDED — there is no PUBLIC entry left in either ACL. The grants
-- that remain are DIRECT grants to `anon` and `authenticated`, which this
-- project's default privileges attach to every new function in `public`.
-- Revoking PUBLIC does not touch them.
--
-- That is the exact mirror of the lesson 20261119140000/150000 already taught
-- in the other direction: a revoke naming only `anon` removes a grant it never
-- had, because the grant is PUBLIC's. Here a revoke naming only PUBLIC removes
-- a grant that is not the one holding the door open. Both revokes succeed and
-- report nothing. `check-migration-security.mjs` enforced the first half and
-- is corrected in the same change as this file, so a PUBLIC-only revoke on a
-- new SECURITY DEFINER function can no longer pass.
--
-- ## Why it mattered, measured rather than assumed
--
-- `market_sales_refresh(jsonb)` is the material one. It is SECURITY DEFINER,
-- reads `supabase_url` from the vault and issues `net.http_post` to
-- `/functions/v1/market-sales-ingest` carrying `cron_service_role_headers()` —
-- a service-role-authenticated internal call — with the caller's own jsonb as
-- the body. An anonymous caller holding the publishable key could therefore
-- start register loads at will: outbound work under this deployment's identity
-- against the Internet Archive, the ABS, DCJ and QGSO, at a 150 s timeout each,
-- which is precisely the standing this product's allowances exist to protect.
--
-- It is NOT an SSRF: every URL `market-sales-ingest` fetches is a module
-- constant or a link discovered on one of those fixed pages, and the body
-- selects only `stage`, `which` and `periods`. No customer data is read or
-- written by either function.
--
-- `geocode_cache_touch(text)` is the lesser one: it increments `hit_count` and
-- stamps `last_hit_at` on a row that must already exist, returns void, and
-- discloses nothing. Telemetry vandalism rather than a disclosure.
--
-- Neither function is called by a browser. `market_sales_refresh` is called by
-- pg_cron; `geocode_cache_touch` by the geocoding chain with the service-role
-- key. Revoking from `anon` and `authenticated` takes nothing away from any
-- caller that exists.

begin;

revoke all on function public.geocode_cache_touch(text) from public, anon, authenticated;
grant execute on function public.geocode_cache_touch(text) to service_role;

revoke all on function public.market_sales_refresh(jsonb) from public, anon, authenticated;
grant execute on function public.market_sales_refresh(jsonb) to service_role;

commit;
