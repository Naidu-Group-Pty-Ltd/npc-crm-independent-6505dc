-- Add ghl_note_id column to client_notes table for tracking synced notes
ALTER TABLE public.client_notes ADD COLUMN IF NOT EXISTS ghl_note_id TEXT;

-- Add comment explaining the column
COMMENT ON COLUMN public.client_notes.ghl_note_id IS 'GoHighLevel note ID for synced notes';