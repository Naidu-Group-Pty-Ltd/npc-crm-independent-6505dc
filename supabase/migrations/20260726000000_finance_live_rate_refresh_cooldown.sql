-- Persist a server-authoritative per-user cooldown for the expensive lender-rate refresh.
ALTER TABLE public.finance_portal_users
  ADD COLUMN IF NOT EXISTS last_live_rates_refresh_at timestamptz;

COMMENT ON COLUMN public.finance_portal_users.last_live_rates_refresh_at IS
  'Last time this portal user claimed the server-side live lender-rate refresh cooldown.';
