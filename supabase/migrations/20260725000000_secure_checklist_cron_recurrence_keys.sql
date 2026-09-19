-- Reserve a distinct idempotency namespace for occurrences created by the cron
-- runner. Client-created/manual occurrence keys retain their existing format.
UPDATE public.checklist_instances
SET recurrence_key = 'cron:' || recurrence_key
WHERE generated_by = 'cron'
  AND recurrence_key IS NOT NULL
  AND recurrence_key NOT LIKE 'cron:%';
