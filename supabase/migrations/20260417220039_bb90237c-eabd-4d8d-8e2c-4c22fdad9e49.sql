-- Recreate analytics views with security_invoker so they respect caller's RLS
ALTER VIEW public.vw_pipeline_funnel SET (security_invoker = true);
ALTER VIEW public.vw_lender_mix SET (security_invoker = true);
ALTER VIEW public.vw_broker_scorecard SET (security_invoker = true);
ALTER VIEW public.vw_revenue_dashboard SET (security_invoker = true);

-- Ensure functions have explicit search_path (already set, but reaffirm)
ALTER FUNCTION public.handle_compliance_version_supersede() SET search_path = public;
ALTER FUNCTION public.handle_submission_commission_forecast() SET search_path = public;