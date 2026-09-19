INSERT INTO public.feature_flags (key, value, description)
VALUES
  ('aml_v3_nav', 'false'::jsonb, 'AML V3: switches AML shell to the Version 3 four-workspace navigation (Compliance Home, Customer Compliance, Transaction Compliance, Regulatory & Assurance) with restricted Organisation Settings. Off = legacy V2 shell.'),
  ('aml_v3_start_client_compliance', 'false'::jsonb, 'AML V3 Directive 1: enables the Command Center master-client "Start Client Compliance" activation surface. Built in Phase 2.'),
  ('aml_v3_compliance_home', 'false'::jsonb, 'AML V3 Directive 5/6: enables the role-adaptive Compliance Home. Built in Phase 3.'),
  ('aml_v3_case_workspace', 'false'::jsonb, 'AML V3 Directive 2/15: enables the case-centred chronological workspace with progressive disclosure. Built in Phases 4 and 6.')
ON CONFLICT (key) DO NOTHING;