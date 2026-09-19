-- Shared tracking id on token-usage records.
--
-- Mission Control echoes the tenant/clone's operator-assigned `billing_user_id`
-- on every token reservation. reportMetering stamps it here so per-user token
-- usage joins Stripe payments (whose sessions/ledger carry the same
-- billing_user_id) on a single key. Nullable: rows metered before an operator
-- assigns a tracking id simply carry null.

ALTER TABLE public.token_usage_history ADD COLUMN IF NOT EXISTS billing_user_id text;
ALTER TABLE public.token_audit_log     ADD COLUMN IF NOT EXISTS billing_user_id text;

CREATE INDEX IF NOT EXISTS idx_tuh_billing_user_created
  ON public.token_usage_history (billing_user_id, created_at DESC)
  WHERE billing_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tal_billing_user_created
  ON public.token_audit_log (billing_user_id, created_at DESC)
  WHERE billing_user_id IS NOT NULL;

COMMENT ON COLUMN public.token_usage_history.billing_user_id IS
  'Mission Control tracking id (clone/tenant billing_user_id) echoed on token reserve; joins usage to Stripe payment attribution.';
