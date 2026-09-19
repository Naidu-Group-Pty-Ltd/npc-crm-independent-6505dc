-- Keep the strict server-side permission map aligned with the module registry.
INSERT INTO public.dashboard_modules (
  module_key,
  module_name,
  description,
  category,
  route,
  sort_order,
  is_active
)
VALUES
  ('deal_pipeline', 'Deal Pipeline', 'Manage client deals and pipeline stages', 'operations', '/deal-pipeline', 29, true),
  ('portfolio_reports', 'Portfolio Reports', 'Manage portfolio reviews and analysis reports', 'reports', '/portfolio-reports', 30, true),
  ('marketing_analytics', 'Marketing Analytics', 'Manage marketing attribution and analytics', 'reports', '/marketing-analytics', 31, true),
  ('portal_config', 'Portal Configuration', 'Manage client portal configuration', 'settings', '/portal-config', 32, true)
ON CONFLICT (module_key) DO NOTHING;
