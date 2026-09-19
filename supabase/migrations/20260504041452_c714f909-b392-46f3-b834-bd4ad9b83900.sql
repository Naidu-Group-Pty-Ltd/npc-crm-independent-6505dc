ALTER TABLE public.migration_jobs DROP CONSTRAINT IF EXISTS migration_jobs_domain_check;
ALTER TABLE public.migration_jobs ADD CONSTRAINT migration_jobs_domain_check
  CHECK (domain IN ('contacts','opportunities','conversations','conversations_replay','notes','tasks','appointments','calendar_groups','calendars','bookings'));

ALTER TABLE public.migration_uploaded_sources DROP CONSTRAINT IF EXISTS migration_uploaded_sources_domain_check;
ALTER TABLE public.migration_uploaded_sources ADD CONSTRAINT migration_uploaded_sources_domain_check
  CHECK (domain IN ('contacts','opportunities','conversations','conversations_replay','calendar_groups','calendars','bookings'));