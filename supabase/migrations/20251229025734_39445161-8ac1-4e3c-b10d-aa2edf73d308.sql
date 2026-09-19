-- Drop existing policies
DROP POLICY IF EXISTS "Anyone can view depreciation comps" ON public.depreciation_comps;
DROP POLICY IF EXISTS "Service role can manage depreciation comps" ON public.depreciation_comps;

-- Create proper policies for all CRUD operations
CREATE POLICY "Anyone can view depreciation comps" 
ON public.depreciation_comps 
FOR SELECT 
USING (true);

CREATE POLICY "Anyone can insert depreciation comps" 
ON public.depreciation_comps 
FOR INSERT 
WITH CHECK (true);

CREATE POLICY "Anyone can update depreciation comps" 
ON public.depreciation_comps 
FOR UPDATE 
USING (true);

CREATE POLICY "Anyone can delete depreciation comps" 
ON public.depreciation_comps 
FOR DELETE 
USING (true);