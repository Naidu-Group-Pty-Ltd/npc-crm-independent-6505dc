INSERT INTO public.feature_flags (key, value, description)
VALUES ('aml_v3_org_settings', 'false'::jsonb, 'AML V3 Phase 9 — Organisation Settings surface: renames Platform Administration, hides tenant plan sales, adds central branding link and Governance & Contacts (Directives 7, 8, 10, 14). Default off.')
ON CONFLICT (key) DO NOTHING;