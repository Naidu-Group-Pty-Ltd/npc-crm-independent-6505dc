ALTER TABLE public.marketing_report_schedules 
ADD COLUMN pipeline_stage_targets JSONB NOT NULL DEFAULT '[]'::jsonb;