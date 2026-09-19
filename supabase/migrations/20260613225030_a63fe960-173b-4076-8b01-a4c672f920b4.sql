
CREATE TABLE IF NOT EXISTS public.property_reclassification_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid,
  source_table text NOT NULL,
  source_property_id uuid NOT NULL,
  target_table text NOT NULL,
  target_property_id uuid,
  mapped_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  error_message text,
  performed_by uuid,
  performed_at timestamptz NOT NULL DEFAULT now(),
  reverted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.property_reclassification_log TO authenticated;
GRANT ALL    ON public.property_reclassification_log TO service_role;

ALTER TABLE public.property_reclassification_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Superadmins can read reclassification log"
  ON public.property_reclassification_log
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'superadmin'::app_role));

CREATE INDEX IF NOT EXISTS idx_prop_reclass_client ON public.property_reclassification_log(client_id);
CREATE INDEX IF NOT EXISTS idx_prop_reclass_source ON public.property_reclassification_log(source_table, source_property_id);
