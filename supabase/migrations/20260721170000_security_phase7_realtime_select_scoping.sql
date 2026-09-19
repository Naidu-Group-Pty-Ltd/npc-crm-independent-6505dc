-- APPLY AFTER the frontend republish that ships the central staff
-- realtime setAuth (useAuth). Applying before republish would break staff
-- realtime on these tables (staff subscriptions would still be anon).
--
-- Phase 7 (F-07): these tables allowed anonymous SELECT (needed by realtime
-- postgres_changes), which let anyone with the publishable anon key read all
-- clients' portal messages/notifications and staff report-QA / agent chat.
--
-- Fix: staff realtime now carries the staff JWT (authenticated) via
-- useAuth's supabase.realtime.setAuth(), so revoking anon SELECT closes the
-- leak while staff keep live updates. Portal users stay anon (no role
-- elevation, no blast radius) and fall back to their existing polling
-- (usePortalUnifiedInbox refetchInterval 15s; PortalNotificationContext 30s).
-- All row DATA is fetched via service-role edge functions (client-portal-comms,
-- staff-client-portal-messages, etc.), so only realtime is affected.
--
-- authenticated retains SELECT (permissive policy still applies to it); since
-- portal users are anon, "authenticated" == staff here.
REVOKE SELECT ON public.report_qa_messages FROM anon;
REVOKE SELECT ON public.report_qa_conversations FROM anon;
REVOKE SELECT ON public.agent_messages FROM anon;
REVOKE SELECT ON public.client_portal_messages FROM anon;
REVOKE SELECT ON public.client_portal_notifications FROM anon;
