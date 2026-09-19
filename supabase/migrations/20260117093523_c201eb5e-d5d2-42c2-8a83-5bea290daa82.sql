-- Drop the existing check constraint
ALTER TABLE public.client_files DROP CONSTRAINT client_files_category_check;

-- Add the updated check constraint with 'vownet' included
ALTER TABLE public.client_files ADD CONSTRAINT client_files_category_check 
CHECK (category = ANY (ARRAY['general', 'contract', 'id', 'financial', 'property', 'correspondence', 'other', 'vownet']));