ALTER TABLE public.client_files DROP CONSTRAINT client_files_category_check;
ALTER TABLE public.client_files ADD CONSTRAINT client_files_category_check
CHECK (category = ANY (ARRAY['general','contract','id','financial','property','correspondence','other','vownet','formara']));