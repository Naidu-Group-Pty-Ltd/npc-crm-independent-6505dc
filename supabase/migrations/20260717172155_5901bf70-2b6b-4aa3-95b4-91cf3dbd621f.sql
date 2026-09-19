INSERT INTO public.feature_flags (key, value, description)
VALUES
  ('aml_v3_terminology_editor', 'false'::jsonb, 'AML V3 Directive 11 — structured terminology label editor (replaces JSON textarea).'),
  ('aml_v3_metrics_relocation', 'false'::jsonb, 'AML V3 Directive 13 — relocate provider metrics widgets away from daily configuration workflow.')
ON CONFLICT (key) DO NOTHING;