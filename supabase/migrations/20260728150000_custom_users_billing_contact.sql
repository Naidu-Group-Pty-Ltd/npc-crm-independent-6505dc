-- Give staff users a real name and phone, so purchases prefill at Stripe.
--
-- `custom_users` carries a login `username` and an `email` but no person name.
-- When a user starts a purchase or saves a card, the command center mints a
-- Mission Control billing handoff that now carries the buyer's contact block
-- through to Stripe — but it can only forward what it knows. Without these
-- columns every buyer retypes their name on Stripe's hosted page, every time.
--
-- All three are optional: a user who never fills them in simply gets the
-- previous behaviour (email-only prefill), and nothing about authentication or
-- authorization reads these fields.

ALTER TABLE public.custom_users
  ADD COLUMN IF NOT EXISTS first_name text,
  ADD COLUMN IF NOT EXISTS last_name  text,
  ADD COLUMN IF NOT EXISTS phone      text;

COMMENT ON COLUMN public.custom_users.first_name IS
  'Given name. Display + billing prefill only; never used for auth.';
COMMENT ON COLUMN public.custom_users.last_name IS
  'Family name. Display + billing prefill only; never used for auth.';
COMMENT ON COLUMN public.custom_users.phone IS
  'Contact phone, forwarded to Stripe as the billing phone when a user buys.';
