-- Add new action types for calendar, checklists, and remaining gaps
ALTER TYPE public.activity_action_type ADD VALUE IF NOT EXISTS 'appointment_created';
ALTER TYPE public.activity_action_type ADD VALUE IF NOT EXISTS 'appointment_updated';
ALTER TYPE public.activity_action_type ADD VALUE IF NOT EXISTS 'appointment_deleted';
ALTER TYPE public.activity_action_type ADD VALUE IF NOT EXISTS 'appointment_rescheduled';
ALTER TYPE public.activity_action_type ADD VALUE IF NOT EXISTS 'checklist_generated';
ALTER TYPE public.activity_action_type ADD VALUE IF NOT EXISTS 'checklist_item_checked';
ALTER TYPE public.activity_action_type ADD VALUE IF NOT EXISTS 'checklist_completed';
ALTER TYPE public.activity_action_type ADD VALUE IF NOT EXISTS 'checklist_deleted';
ALTER TYPE public.activity_action_type ADD VALUE IF NOT EXISTS 'data_imported';
ALTER TYPE public.activity_action_type ADD VALUE IF NOT EXISTS 'whitelabel_logo_uploaded';
ALTER TYPE public.activity_action_type ADD VALUE IF NOT EXISTS 'whitelabel_logo_removed';
ALTER TYPE public.activity_action_type ADD VALUE IF NOT EXISTS 'whitelabel_theme_changed';
ALTER TYPE public.activity_action_type ADD VALUE IF NOT EXISTS 'comparison_pdf_downloaded';
ALTER TYPE public.activity_action_type ADD VALUE IF NOT EXISTS 'portfolio_report_generated';

-- Add new entity types
ALTER TYPE public.activity_entity_type ADD VALUE IF NOT EXISTS 'appointment';
ALTER TYPE public.activity_entity_type ADD VALUE IF NOT EXISTS 'checklist';
ALTER TYPE public.activity_entity_type ADD VALUE IF NOT EXISTS 'data_import';
ALTER TYPE public.activity_entity_type ADD VALUE IF NOT EXISTS 'portfolio_report';