-- Applied to production 2026-07-21 via MCP (security_phase7_lock_sensitive_service_tables).
--
-- CRITICAL (F-07): anon/authenticated held SELECT + write grants with {public}
-- qual=true policies on sensitive, service-managed tables. Verified live before
-- the fix: an anonymous request carrying only the publishable anon key could
-- read client income/employment PII (client_income_sources), client home
-- addresses (client_address_history) and staff activity logs (activity_logs).
-- The anon key ships in the public frontend bundle, so this data was
-- effectively world-readable.
--
-- All 10 tables have ZERO direct frontend references — every read/write flows
-- through service-role edge functions (log-activity, get-client-data,
-- finance-portal-*, etc.). Revoke all anon/authenticated access; service_role
-- keeps full grants and bypasses RLS. Post-fix: anon reads -> 42501.
REVOKE ALL ON public.client_income_sources FROM anon, authenticated;
REVOKE ALL ON public.client_address_history FROM anon, authenticated;
REVOKE ALL ON public.client_deals FROM anon, authenticated;
REVOKE ALL ON public.build_progress_payments FROM anon, authenticated;
REVOKE ALL ON public.builder_invoices FROM anon, authenticated;
REVOKE ALL ON public.finance_agent_contacts FROM anon, authenticated;
REVOKE ALL ON public.activity_logs FROM anon, authenticated;
REVOKE ALL ON public.api_usage_log FROM anon, authenticated;
REVOKE ALL ON public.pdf_import_audit_log FROM anon, authenticated;
REVOKE ALL ON public.template_audit_log FROM anon, authenticated;
