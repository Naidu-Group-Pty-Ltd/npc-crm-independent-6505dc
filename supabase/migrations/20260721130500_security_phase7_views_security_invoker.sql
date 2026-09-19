-- Applied to production 2026-07-21 via MCP (security_phase7_views_security_invoker).
-- Phase 7 §12.4 — convert SECURITY DEFINER views to security_invoker
-- (advisor ERROR: security_definer_view). These postgres-owned views bypassed
-- RLS on their base tables. security_invoker makes them run with the querying
-- role's privileges so base-table RLS applies. Service-role callers (the
-- finance edge functions that read purchase_file_activity_feed) are unchanged
-- because service_role bypasses RLS regardless.
ALTER VIEW public.purchase_file_activity_feed SET (security_invoker = true);
ALTER VIEW public.v_purchase_file_deal_drift SET (security_invoker = true);
ALTER VIEW public.client_portfolio_properties SET (security_invoker = true);
