ALTER TABLE public.token_audit_log
  ALTER COLUMN requested_tokens SET DEFAULT 0,
  ALTER COLUMN reserved_tokens  SET DEFAULT 0,
  ALTER COLUMN used_tokens      SET DEFAULT 0,
  ALTER COLUMN available_tokens SET DEFAULT 0;