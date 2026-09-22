-- Remove the legacy public read policy. Operational health logs are restricted
-- to the service_role policies established by the existing hardening migration.
DROP POLICY IF EXISTS "Anyone can view API health logs" ON public.api_health_log;
