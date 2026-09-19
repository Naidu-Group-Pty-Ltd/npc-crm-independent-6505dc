-- Cache the workspace's entitled add-on slugs alongside its plan.
--
-- Plan-tier gating alone could never decide a separately-sold module: those
-- carry an empty tier list, so `planIncludesModule` deliberately fell through
-- to the user-permission check rather than lock out a workspace that had paid
-- for the add-on. Mission Control now supplies the held add-ons on the balance
-- call, and this is where the clone keeps them.
--
-- Cached with the plan rather than fetched separately for one reason: if a
-- cache hit returned the plan but no add-ons, a Mission Control outage would
-- briefly strip modules a customer pays for. Gating must never be the reason
-- someone loses access to something they bought — the two have to travel
-- together or not at all.
--
-- Defaults to an empty array, which reproduces exactly today's behaviour
-- (add-ons fall through to the permission check) rather than a lockout.

ALTER TABLE public.token_balance_cache
  ADD COLUMN IF NOT EXISTS addon_slugs text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.token_balance_cache.addon_slugs IS
  'Priced add-on slugs the workspace holds, mirrored from Mission Control on each balance refresh. Empty means "none known", which the gate treats as fall-through, never as denial.';
