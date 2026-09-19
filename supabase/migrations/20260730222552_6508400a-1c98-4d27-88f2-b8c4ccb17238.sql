ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type ~ '^[a-z][a-z0-9_]{2,63}$')
  NOT VALID;

ALTER TABLE public.notifications VALIDATE CONSTRAINT notifications_type_check;