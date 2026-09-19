CREATE POLICY "Allow authenticated users to read portal configuration"
  ON public.portal_configuration
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow anon to read portal configuration"
  ON public.portal_configuration
  FOR SELECT
  TO anon
  USING (true);