-- Add last_note_at column to track when the most recent note was added
ALTER TABLE public.clients 
ADD COLUMN IF NOT EXISTS last_note_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;

-- Create index for efficient sorting by last note activity
CREATE INDEX IF NOT EXISTS idx_clients_last_note_at 
ON public.clients(last_note_at DESC NULLS LAST);

-- Backfill existing data from client_notes
UPDATE public.clients c
SET last_note_at = (
  SELECT MAX(created_at) 
  FROM public.client_notes cn 
  WHERE cn.client_id = c.id
)
WHERE EXISTS (
  SELECT 1 FROM public.client_notes cn WHERE cn.client_id = c.id
);