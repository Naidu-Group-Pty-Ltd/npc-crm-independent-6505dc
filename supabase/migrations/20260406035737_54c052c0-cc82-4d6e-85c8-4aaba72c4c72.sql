
-- Add report_type and audience_segment columns to marketing_report_schedules
ALTER TABLE public.marketing_report_schedules 
  ADD COLUMN IF NOT EXISTS report_type TEXT NOT NULL DEFAULT 'full',
  ADD COLUMN IF NOT EXISTS audience_segment TEXT NOT NULL DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS content_rotation_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rotation_sequence TEXT[] NOT NULL DEFAULT ARRAY['market_pulse','hotspot_deep_dive','strategy_insight','finance_update','deal_breakdown','myth_busting','development_spotlight'],
  ADD COLUMN IF NOT EXISTS current_rotation_index INTEGER NOT NULL DEFAULT 0;

-- Add report_type and audience_segment to marketing_intelligence_reports
ALTER TABLE public.marketing_intelligence_reports
  ADD COLUMN IF NOT EXISTS report_type TEXT NOT NULL DEFAULT 'full',
  ADD COLUMN IF NOT EXISTS audience_segment TEXT NOT NULL DEFAULT 'general';

-- Add check constraints for valid values
ALTER TABLE public.marketing_report_schedules
  ADD CONSTRAINT chk_report_type CHECK (report_type IN ('full', 'market_pulse', 'hotspot_deep_dive', 'strategy_insight', 'finance_update', 'deal_breakdown', 'myth_busting', 'development_spotlight')),
  ADD CONSTRAINT chk_audience_segment CHECK (audience_segment IN ('general', 'investor', 'owner_occupier'));

ALTER TABLE public.marketing_intelligence_reports
  ADD CONSTRAINT chk_mir_report_type CHECK (report_type IN ('full', 'market_pulse', 'hotspot_deep_dive', 'strategy_insight', 'finance_update', 'deal_breakdown', 'myth_busting', 'development_spotlight')),
  ADD CONSTRAINT chk_mir_audience_segment CHECK (audience_segment IN ('general', 'investor', 'owner_occupier'));
