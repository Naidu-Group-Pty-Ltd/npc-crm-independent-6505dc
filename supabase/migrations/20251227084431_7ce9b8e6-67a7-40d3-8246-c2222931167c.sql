-- Create enum for action types
CREATE TYPE public.activity_action_type AS ENUM (
  -- Report actions
  'report_generated',
  'report_regenerated',
  'report_viewed',
  'report_edited',
  'report_archived',
  'report_deleted',
  'report_pdf_downloaded',
  'report_shared',
  'manual_override_applied',
  
  -- Comparison actions
  'comparison_created',
  'comparison_viewed',
  'comparison_deleted',
  
  -- Cash flow actions
  'cash_flow_created',
  'cash_flow_updated',
  'cash_flow_deleted',
  
  -- Email actions
  'email_read',
  'email_reply_generated',
  'email_reply_sent',
  'email_linked_to_report',
  
  -- Call log actions
  'call_tagged',
  'alert_rule_created',
  'alert_rule_updated',
  'alert_rule_deleted',
  'weekly_report_config_changed',
  
  -- QA actions
  'qa_conversation_created',
  'qa_question_asked',
  'qa_conversation_deleted',
  
  -- Automation actions
  'automation_switch_created',
  'automation_switch_enabled',
  'automation_switch_disabled',
  'automation_switch_deleted',
  'automation_master_toggle_changed',
  
  -- Template actions
  'template_uploaded',
  'template_activated',
  'template_deactivated',
  'template_deleted',
  'branding_profile_created',
  'branding_profile_updated',
  'branding_profile_deleted',
  
  -- User management actions
  'user_invited',
  'user_permissions_changed',
  'user_deactivated',
  'user_activated',
  'password_reset_initiated',
  
  -- White label actions
  'whitelabel_settings_updated',
  'whitelabel_logo_changed',
  
  -- Auth actions
  'user_login',
  'user_logout',
  
  -- Bulk actions
  'bulk_generation_started',
  'bulk_generation_completed',
  
  -- General
  'settings_updated',
  'data_exported'
);

-- Create enum for entity types
CREATE TYPE public.activity_entity_type AS ENUM (
  'investment_report',
  'property_comparison',
  'cash_flow_analysis',
  'email',
  'call_log',
  'call_alert_rule',
  'qa_conversation',
  'automation_switch',
  'template',
  'branding_profile',
  'user',
  'whitelabel_settings',
  'bulk_generation_job',
  'system'
);

-- Create the activity_logs table
CREATE TABLE public.activity_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.custom_users(id) ON DELETE SET NULL,
  username TEXT, -- Denormalized for performance and in case user is deleted
  action_type public.activity_action_type NOT NULL,
  entity_type public.activity_entity_type NOT NULL,
  entity_id UUID, -- The ID of the affected entity
  entity_name TEXT, -- Human-readable name (e.g., property address)
  metadata JSONB DEFAULT '{}'::jsonb, -- Additional context (old values, new values, etc.)
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create indexes for common queries
CREATE INDEX idx_activity_logs_user_id ON public.activity_logs(user_id);
CREATE INDEX idx_activity_logs_action_type ON public.activity_logs(action_type);
CREATE INDEX idx_activity_logs_entity_type ON public.activity_logs(entity_type);
CREATE INDEX idx_activity_logs_entity_id ON public.activity_logs(entity_id);
CREATE INDEX idx_activity_logs_created_at ON public.activity_logs(created_at DESC);
CREATE INDEX idx_activity_logs_user_action ON public.activity_logs(user_id, action_type);
CREATE INDEX idx_activity_logs_entity ON public.activity_logs(entity_type, entity_id);

-- Enable RLS
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Anyone authenticated can view activity logs
CREATE POLICY "Anyone can view activity logs"
  ON public.activity_logs
  FOR SELECT
  USING (true);

-- Only service role can insert (via edge functions or triggers)
CREATE POLICY "Service role can insert activity logs"
  ON public.activity_logs
  FOR INSERT
  WITH CHECK (true);

-- No updates allowed - logs are immutable
-- No deletes allowed - logs should be preserved

-- Create a function to log activities (can be called from triggers or edge functions)
CREATE OR REPLACE FUNCTION public.log_activity(
  p_user_id UUID,
  p_username TEXT,
  p_action_type public.activity_action_type,
  p_entity_type public.activity_entity_type,
  p_entity_id UUID DEFAULT NULL,
  p_entity_name TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb,
  p_ip_address TEXT DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_log_id UUID;
BEGIN
  INSERT INTO public.activity_logs (
    user_id,
    username,
    action_type,
    entity_type,
    entity_id,
    entity_name,
    metadata,
    ip_address,
    user_agent
  ) VALUES (
    p_user_id,
    p_username,
    p_action_type,
    p_entity_type,
    p_entity_id,
    p_entity_name,
    p_metadata,
    p_ip_address,
    p_user_agent
  )
  RETURNING id INTO v_log_id;
  
  RETURN v_log_id;
END;
$$;

-- Create a view for easier querying with user info
CREATE OR REPLACE VIEW public.activity_logs_with_user AS
SELECT 
  al.*,
  COALESCE(al.username, cu.username, 'Unknown User') as display_username,
  cu.email as user_email,
  cu.role as user_role
FROM public.activity_logs al
LEFT JOIN public.custom_users cu ON al.user_id = cu.id
ORDER BY al.created_at DESC;

-- Function to get activity summary for a user
CREATE OR REPLACE FUNCTION public.get_user_activity_summary(
  p_user_id UUID,
  p_days_back INTEGER DEFAULT 30
)
RETURNS TABLE (
  action_type public.activity_action_type,
  entity_type public.activity_entity_type,
  count BIGINT,
  last_occurrence TIMESTAMP WITH TIME ZONE
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    action_type,
    entity_type,
    COUNT(*) as count,
    MAX(created_at) as last_occurrence
  FROM public.activity_logs
  WHERE user_id = p_user_id
    AND created_at >= NOW() - (p_days_back || ' days')::INTERVAL
  GROUP BY action_type, entity_type
  ORDER BY count DESC;
$$;

-- Function to get recent activities for dashboard
CREATE OR REPLACE FUNCTION public.get_recent_activities(
  p_limit INTEGER DEFAULT 50,
  p_entity_type public.activity_entity_type DEFAULT NULL,
  p_user_id UUID DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  username TEXT,
  action_type public.activity_action_type,
  entity_type public.activity_entity_type,
  entity_id UUID,
  entity_name TEXT,
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    al.id,
    al.user_id,
    COALESCE(al.username, cu.username, 'Unknown') as username,
    al.action_type,
    al.entity_type,
    al.entity_id,
    al.entity_name,
    al.metadata,
    al.created_at
  FROM public.activity_logs al
  LEFT JOIN public.custom_users cu ON al.user_id = cu.id
  WHERE (p_entity_type IS NULL OR al.entity_type = p_entity_type)
    AND (p_user_id IS NULL OR al.user_id = p_user_id)
  ORDER BY al.created_at DESC
  LIMIT p_limit;
$$;

-- Enable real-time for activity logs
ALTER PUBLICATION supabase_realtime ADD TABLE public.activity_logs;