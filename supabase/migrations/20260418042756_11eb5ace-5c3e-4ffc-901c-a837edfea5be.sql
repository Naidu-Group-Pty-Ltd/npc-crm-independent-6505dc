
-- Defensive backfill: if any rows still have NULL email, fall back to username@placeholder.local
-- so the NOT NULL constraint can be applied safely. (Currently zero rows match.)
UPDATE public.custom_users
SET email = lower(regexp_replace(coalesce(username, id::text), '[^a-zA-Z0-9._-]', '_', 'g')) || '@placeholder.local'
WHERE email IS NULL OR btrim(email) = '';

-- Normalise existing emails to lowercase + trimmed for consistent uniqueness
UPDATE public.custom_users
SET email = lower(btrim(email))
WHERE email IS NOT NULL AND email <> lower(btrim(email));

-- Enforce NOT NULL
ALTER TABLE public.custom_users
  ALTER COLUMN email SET NOT NULL;

-- Enforce basic email format (only when not a placeholder)
ALTER TABLE public.custom_users
  ADD CONSTRAINT custom_users_email_format_chk
  CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$');

-- Enforce case-insensitive uniqueness
CREATE UNIQUE INDEX IF NOT EXISTS custom_users_email_lower_uniq
  ON public.custom_users (lower(email));
