-- APPLY AFTER the frontend republish that ships the authenticated-client
-- writes (charts/generated_reports/global_report_settings/template_comments/
-- template_components/whitelabel_settings). Applying before republish would
-- break the currently-live anon-client writes.
--
-- Phase 7 (F-07): these 6 tables were written with the anon client, so anyone
-- with the publishable anon key could insert/tamper (report artifacts) or
-- deface admin config (whitelabel, global report settings). The frontend now
-- writes with the staff JWT (authenticated). Revoke anon write grants so only
-- staff (the only holders of a Supabase-compatible JWT) can write; reads and
-- realtime stay on the anon client (SELECT grant preserved).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.charts FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.generated_reports FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.template_comments FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.template_components FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.global_report_settings FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.whitelabel_settings FROM anon;

-- FOLLOW-UP (not in this migration): tighten global_report_settings and
-- whitelabel_settings writes from any-staff to admin-only via an RLS role
-- check once the canonical-role resolver is relied upon.
