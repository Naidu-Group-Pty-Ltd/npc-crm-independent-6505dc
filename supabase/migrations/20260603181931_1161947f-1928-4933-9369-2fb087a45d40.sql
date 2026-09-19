ALTER TABLE public.report_visual_assets
ADD COLUMN IF NOT EXISTS include_in_report boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_rva_report_include
ON public.report_visual_assets (report_id, include_in_report, status);