DROP POLICY IF EXISTS "Service role can manage client sync events" ON public.client_sync_events;

CREATE POLICY "Service role can manage client sync events"
ON public.client_sync_events
FOR ALL
TO public
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');