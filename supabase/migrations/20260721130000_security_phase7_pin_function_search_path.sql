-- Applied to production 2026-07-21 via MCP (security_phase7_pin_function_search_path).
-- Phase 7 §12.4 — pin search_path on mutable-search_path functions
-- (advisor: function_search_path_mutable). All 8 are trigger functions
-- (NEW.updated_at := now()) or IMMUTABLE SQL helpers referencing only
-- pg_catalog builtins, so an empty search_path is safe and removes the
-- search_path-injection surface.
ALTER FUNCTION aml.set_updated_at() SET search_path = '';
ALTER FUNCTION aml.tg_touch_updated_at() SET search_path = '';
ALTER FUNCTION aml.touch_updated_at() SET search_path = '';
ALTER FUNCTION public.fp_threads_set_updated_at() SET search_path = '';
ALTER FUNCTION public.set_updated_at_timestamp() SET search_path = '';
ALTER FUNCTION public.touch_pdf_import_chunks_updated_at() SET search_path = '';
ALTER FUNCTION public.chart_config_is_live(jsonb) SET search_path = '';
ALTER FUNCTION public.address_values_match(text, text, text, text, text, text, text, text, text, text) SET search_path = '';
