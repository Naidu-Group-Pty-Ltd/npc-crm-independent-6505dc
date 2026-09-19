-- Drop existing restrictive policies on property_comparisons
DROP POLICY IF EXISTS "Users can view their own comparisons" ON public.property_comparisons;
DROP POLICY IF EXISTS "Users can create comparisons" ON public.property_comparisons;
DROP POLICY IF EXISTS "Users can update their own comparisons" ON public.property_comparisons;
DROP POLICY IF EXISTS "Users can delete their own comparisons" ON public.property_comparisons;

-- Create new global policies for all authenticated users
CREATE POLICY "All authenticated users can view all comparisons"
ON public.property_comparisons
FOR SELECT
USING (true);

CREATE POLICY "All authenticated users can create comparisons"
ON public.property_comparisons
FOR INSERT
WITH CHECK (true);

CREATE POLICY "All authenticated users can update all comparisons"
ON public.property_comparisons
FOR UPDATE
USING (true);

CREATE POLICY "All authenticated users can delete all comparisons"
ON public.property_comparisons
FOR DELETE
USING (true);