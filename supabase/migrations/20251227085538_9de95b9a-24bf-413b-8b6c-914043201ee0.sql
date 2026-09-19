-- Add new enum values for Phase 4 activity tracking
ALTER TYPE activity_action_type ADD VALUE IF NOT EXISTS 'template_uploaded';
ALTER TYPE activity_action_type ADD VALUE IF NOT EXISTS 'template_deleted';
ALTER TYPE activity_action_type ADD VALUE IF NOT EXISTS 'branding_created';
ALTER TYPE activity_action_type ADD VALUE IF NOT EXISTS 'branding_updated';
ALTER TYPE activity_action_type ADD VALUE IF NOT EXISTS 'branding_deleted';
ALTER TYPE activity_action_type ADD VALUE IF NOT EXISTS 'user_created';
ALTER TYPE activity_action_type ADD VALUE IF NOT EXISTS 'user_deleted';
ALTER TYPE activity_action_type ADD VALUE IF NOT EXISTS 'user_promoted';
ALTER TYPE activity_action_type ADD VALUE IF NOT EXISTS 'user_demoted';
ALTER TYPE activity_action_type ADD VALUE IF NOT EXISTS 'permissions_updated';

ALTER TYPE activity_entity_type ADD VALUE IF NOT EXISTS 'template';
ALTER TYPE activity_entity_type ADD VALUE IF NOT EXISTS 'branding';
ALTER TYPE activity_entity_type ADD VALUE IF NOT EXISTS 'user';