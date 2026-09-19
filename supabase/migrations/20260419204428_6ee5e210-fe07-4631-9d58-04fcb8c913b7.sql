UPDATE public.finance_portal_users
SET
  has_accepted_terms = true,
  terms_accepted_at = COALESCE(terms_accepted_at, last_login_at, now()),
  has_completed_onboarding = true
WHERE last_login_at IS NOT NULL
  AND (has_accepted_terms = false OR has_completed_onboarding = false);