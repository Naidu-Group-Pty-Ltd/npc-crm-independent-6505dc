-- Fix 1: Backfill NULL next_run_at for the Daily Morning Briefing task
UPDATE public.agent_scheduled_tasks 
SET next_run_at = now() + interval '1 minute'
WHERE next_run_at IS NULL AND is_enabled = true;

-- Fix 2: Fix broken playbook steps that use placeholder tool names
-- Replace placeholder tool names with the real 'create_checklist_template' tool
UPDATE public.agent_playbooks
SET steps = (
  SELECT jsonb_agg(
    CASE 
      WHEN step->>'tool_name' LIKE '%placeholder%' 
      THEN jsonb_set(step, '{tool_name}', '"create_checklist_template"')
      ELSE step
    END
  )
  FROM jsonb_array_elements(steps) AS step
)
WHERE steps::text LIKE '%placeholder%';