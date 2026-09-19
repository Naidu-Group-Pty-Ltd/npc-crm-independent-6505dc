-- Add entity_id column to notifications table for linking to various entities
ALTER TABLE public.notifications 
ADD COLUMN IF NOT EXISTS entity_id text;