-- Add new action types to the enum
ALTER TYPE public.activity_action_type ADD VALUE IF NOT EXISTS 'login';
ALTER TYPE public.activity_action_type ADD VALUE IF NOT EXISTS 'logout';

-- Add new entity type to the enum  
ALTER TYPE public.activity_entity_type ADD VALUE IF NOT EXISTS 'session';