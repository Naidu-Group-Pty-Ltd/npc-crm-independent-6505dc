-- =====================================================================
-- Template Builder rehaul Phase 4: resolver ranking moves into SQL.
--
-- resolve_report_template() ranks active report_templates rows for a
-- report_type + variant + scope context and returns the single winner.
-- Precedence (first match wins):
--   1. scope=user    + owner_user_id  + variant match (or template variant NULL)
--   2. scope=agency  + agency_id      + variant match (or template variant NULL)
--   3. scope=global  + exact variant match
--   4. scope=global  + variant IS NULL (catch-all)
-- Ties break by priority DESC, then updated_at DESC.
--
-- This is the single source of truth previously duplicated (KEEP IN SYNC)
-- in src/lib/reportTemplate/resolveTemplate.ts and
-- supabase/functions/_shared/resolveReportTemplate.ts. Both now call this
-- RPC first and only fall back to the JS ranking when the function is
-- unavailable (pre-migration deployments).
--
-- Unlike the JS fallback, this ranks ALL active rows (the fallback fetches
-- the 200 most recently updated rows before ranking).
-- =====================================================================

CREATE OR REPLACE FUNCTION public.resolve_report_template(
  p_report_type text,
  p_variant text DEFAULT NULL,
  p_agency_id uuid DEFAULT NULL,
  p_user_id uuid DEFAULT NULL
)
RETURNS TABLE (template jsonb, source text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH candidates AS (
    SELECT
      t.*,
      CASE
        WHEN t.scope = 'user'
             AND p_user_id IS NOT NULL
             AND t.owner_user_id = p_user_id
             AND (t.variant IS NULL OR t.variant = p_variant)
          THEN 1
        WHEN t.scope = 'agency'
             AND p_agency_id IS NOT NULL
             AND t.agency_id = p_agency_id
             AND (t.variant IS NULL OR t.variant = p_variant)
          THEN 2
        WHEN COALESCE(t.scope, 'global') = 'global'
             AND t.variant IS NOT NULL
             AND t.variant = p_variant
          THEN 3
        WHEN COALESCE(t.scope, 'global') = 'global'
             AND t.variant IS NULL
          THEN 4
        ELSE NULL
      END AS rank_source
    FROM public.report_templates t
    WHERE t.report_type = lower(p_report_type)
      AND t.is_active = true
  )
  SELECT
    to_jsonb(c) - 'rank_source' AS template,
    CASE c.rank_source
      WHEN 1 THEN 'user'
      WHEN 2 THEN 'agency'
      WHEN 3 THEN 'global-variant'
      ELSE 'global-any'
    END AS source
  FROM candidates c
  WHERE c.rank_source IS NOT NULL
  ORDER BY
    c.rank_source ASC,
    COALESCE(c.priority, 0) DESC,
    c.updated_at DESC NULLS LAST
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.resolve_report_template(text, text, uuid, uuid) IS
  'Ranks active report_templates by scope precedence (user > agency > global-variant > global-any), priority DESC, updated_at DESC and returns the winning row as jsonb plus its source label.';

GRANT EXECUTE ON FUNCTION public.resolve_report_template(text, text, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_report_template(text, text, uuid, uuid) TO service_role;
