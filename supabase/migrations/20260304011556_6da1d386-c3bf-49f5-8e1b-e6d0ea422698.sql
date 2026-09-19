-- Add new action types for client management
ALTER TYPE public.activity_action_type ADD VALUE IF NOT EXISTS 'client_created';
ALTER TYPE public.activity_action_type ADD VALUE IF NOT EXISTS 'client_updated';
ALTER TYPE public.activity_action_type ADD VALUE IF NOT EXISTS 'client_deleted';
ALTER TYPE public.activity_action_type ADD VALUE IF NOT EXISTS 'client_exported';
ALTER TYPE public.activity_action_type ADD VALUE IF NOT EXISTS 'client_file_uploaded';
ALTER TYPE public.activity_action_type ADD VALUE IF NOT EXISTS 'client_file_deleted';
ALTER TYPE public.activity_action_type ADD VALUE IF NOT EXISTS 'client_note_added';
ALTER TYPE public.activity_action_type ADD VALUE IF NOT EXISTS 'client_tag_added';
ALTER TYPE public.activity_action_type ADD VALUE IF NOT EXISTS 'client_tag_removed';

-- Add new action types for deal pipeline
ALTER TYPE public.activity_action_type ADD VALUE IF NOT EXISTS 'deal_created';
ALTER TYPE public.activity_action_type ADD VALUE IF NOT EXISTS 'deal_updated';
ALTER TYPE public.activity_action_type ADD VALUE IF NOT EXISTS 'deal_stage_changed';
ALTER TYPE public.activity_action_type ADD VALUE IF NOT EXISTS 'deal_deleted';
ALTER TYPE public.activity_action_type ADD VALUE IF NOT EXISTS 'build_payment_updated';

-- Add new entity types
ALTER TYPE public.activity_entity_type ADD VALUE IF NOT EXISTS 'client';
ALTER TYPE public.activity_entity_type ADD VALUE IF NOT EXISTS 'deal';
ALTER TYPE public.activity_entity_type ADD VALUE IF NOT EXISTS 'client_file';
ALTER TYPE public.activity_entity_type ADD VALUE IF NOT EXISTS 'client_note';