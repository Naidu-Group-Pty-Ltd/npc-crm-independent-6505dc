-- Carry the plan slug through the balance cache.
--
-- Plan-tier feature gating keys on the slug (launch/growth/scale), not the
-- display name, so `mission-control-balance` now returns it and writes it back
-- to the cache. Without this column that upsert fails on an unknown column and
-- the cache silently stops refreshing — the same shape as the purchases outage
-- of 2026-07-25, where one missing column took out a whole write path.
--
-- Nullable by design: an older Mission Control, or a billing-exempt tenant,
-- legitimately has no plan, and gating treats an absent slug as "unknown" and
-- allows rather than locking anyone out.

ALTER TABLE public.token_balance_cache
  ADD COLUMN IF NOT EXISTS plan_slug TEXT;

COMMENT ON COLUMN public.token_balance_cache.plan_slug IS
  'Mission Control billing plan slug (launch/growth/scale). Drives plan-tier feature gating; NULL means unknown, which gates open.';

NOTIFY pgrst, 'reload schema';
