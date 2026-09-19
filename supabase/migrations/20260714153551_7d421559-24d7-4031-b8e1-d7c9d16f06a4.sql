
-- Quantitative reports (generated_reports + charts + chart_configurations) are
-- saved from the browser via the anon Supabase client because this project uses
-- a custom auth layer (auth.uid() is always null). Existing SELECT policies
-- already allow anon reads; align write policies so inserts stop failing.

-- generated_reports: replace auth.uid()-gated INSERT with a permissive anon+auth policy
DROP POLICY IF EXISTS "Users can create their own reports" ON public.generated_reports;
CREATE POLICY "Anyone can create generated reports"
  ON public.generated_reports FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Anyone can update generated reports"
  ON public.generated_reports FOR UPDATE
  TO anon, authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "Anyone can delete generated reports"
  ON public.generated_reports FOR DELETE
  TO anon, authenticated
  USING (true);

-- charts: replace auth.uid()-gated policies (which reference generated_by)
DROP POLICY IF EXISTS "Users can create charts for their own reports" ON public.charts;
DROP POLICY IF EXISTS "Users can update charts from their own reports" ON public.charts;
DROP POLICY IF EXISTS "Users can delete charts from their own reports" ON public.charts;
DROP POLICY IF EXISTS "Users can view charts from their own reports" ON public.charts;

CREATE POLICY "Anyone can view charts"
  ON public.charts FOR SELECT
  TO anon, authenticated
  USING (true);
CREATE POLICY "Anyone can create charts"
  ON public.charts FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);
CREATE POLICY "Anyone can update charts"
  ON public.charts FOR UPDATE
  TO anon, authenticated
  USING (true) WITH CHECK (true);
CREATE POLICY "Anyone can delete charts"
  ON public.charts FOR DELETE
  TO anon, authenticated
  USING (true);

-- Ensure explicit GRANTs (Data API requires them)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.generated_reports TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.charts TO anon, authenticated;
GRANT ALL ON public.generated_reports TO service_role;
GRANT ALL ON public.charts TO service_role;
