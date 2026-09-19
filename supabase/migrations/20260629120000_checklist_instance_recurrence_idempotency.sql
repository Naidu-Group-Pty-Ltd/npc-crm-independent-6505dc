-- Add explicit occurrence metadata for generated checklist instances.
-- Templates remain reusable blueprints; instances are dated occurrences.
ALTER TABLE public.checklist_instances
  ADD COLUMN IF NOT EXISTS due_date DATE,
  ADD COLUMN IF NOT EXISTS recurrence_key TEXT;

-- Backfill existing instance dates so old checklist history is preserved and remains queryable.
UPDATE public.checklist_instances
SET due_date = created_at::date
WHERE due_date IS NULL;

-- Preserve every existing row even if historical duplicates already exist for the same template/date/owner.
-- The first historical occurrence gets the canonical template:date:owner key used by recurrence checks;
-- additional historical duplicates keep unique suffixes instead of blocking the migration.
WITH ranked_instances AS (
  SELECT
    ci.id,
    COALESCE(ci.template_id::text, ci.id::text) || ':' || ci.due_date::text || ':' || COALESCE(ct.created_by, ci.generated_by, 'global') AS canonical_key,
    row_number() OVER (
      PARTITION BY ci.template_id, ci.due_date, COALESCE(ct.created_by, ci.generated_by, 'global')
      ORDER BY ci.created_at, ci.id
    ) AS duplicate_rank
  FROM public.checklist_instances ci
  LEFT JOIN public.checklist_templates ct ON ct.id = ci.template_id
  WHERE ci.recurrence_key IS NULL
)
UPDATE public.checklist_instances ci
SET recurrence_key = CASE
  WHEN ranked_instances.duplicate_rank = 1 THEN ranked_instances.canonical_key
  ELSE ranked_instances.canonical_key || ':' || ci.id::text
END
FROM ranked_instances
WHERE ci.id = ranked_instances.id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_checklist_instances_recurrence_key
  ON public.checklist_instances(recurrence_key)
  WHERE recurrence_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_checklist_instances_due_date
  ON public.checklist_instances(due_date);

CREATE INDEX IF NOT EXISTS idx_checklist_instances_template_due_date
  ON public.checklist_instances(template_id, due_date)
  WHERE template_id IS NOT NULL;
