-- Add is_favorite column to clients table
ALTER TABLE public.clients ADD COLUMN is_favorite BOOLEAN NOT NULL DEFAULT false;

-- Create index for faster favorite lookups
CREATE INDEX idx_clients_is_favorite ON public.clients(is_favorite) WHERE is_favorite = true;