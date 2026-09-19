-- Drop existing constraint and add updated one with call_completed type
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE notifications ADD CONSTRAINT notifications_type_check 
CHECK (type = ANY (ARRAY['report_generated', 'report_failed', 'info', 'call_completed']));