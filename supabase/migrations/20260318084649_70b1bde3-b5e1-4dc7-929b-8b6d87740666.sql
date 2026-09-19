-- Drop overly restrictive SELECT policies
DROP POLICY IF EXISTS "Users can view pipelines for their clients" ON public.ghl_pipelines;
DROP POLICY IF EXISTS "Users can view stages for pipelines used by their clients" ON public.ghl_pipeline_stages;

-- Allow all authenticated users to view pipelines and stages
CREATE POLICY "Authenticated users can view pipelines"
  ON public.ghl_pipelines FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can view pipeline stages"
  ON public.ghl_pipeline_stages FOR SELECT
  TO authenticated
  USING (true);