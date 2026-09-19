-- Backfill investment_reports.generated_by from activity_logs where possible
WITH first_gen AS (
  SELECT DISTINCT ON (al.entity_id)
    al.entity_id AS report_id,
    al.user_id
  FROM activity_logs al
  WHERE al.action_type::text IN ('report_generated','report_regenerated')
    AND al.user_id IS NOT NULL
    AND al.entity_id IS NOT NULL
  ORDER BY al.entity_id, al.created_at ASC
)
UPDATE investment_reports ir
SET generated_by = fg.user_id
FROM first_gen fg
WHERE ir.id = fg.report_id
  AND ir.generated_by IS NULL;