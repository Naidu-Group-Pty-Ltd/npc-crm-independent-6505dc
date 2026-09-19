INSERT INTO public.feature_flags (key, value, description)
VALUES ('aml_v3_regulatory_hub', 'false'::jsonb, 'AML V3 Phase 5 — Regulatory & Assurance surfacing (submission readiness header on AUSTRAC Hub). Default off.')
ON CONFLICT (key) DO NOTHING;