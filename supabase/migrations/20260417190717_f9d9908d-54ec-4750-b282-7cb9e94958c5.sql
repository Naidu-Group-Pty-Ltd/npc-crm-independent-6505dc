
CREATE TABLE IF NOT EXISTS public.bc_scenarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_base BOOLEAN NOT NULL DEFAULT false,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES public.custom_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bc_scenarios_client_id ON public.bc_scenarios(client_id);
CREATE INDEX IF NOT EXISTS idx_bc_scenarios_client_created ON public.bc_scenarios(client_id, created_at DESC);

ALTER TABLE public.bc_scenarios ENABLE ROW LEVEL SECURITY;

-- Service role only (custom auth pattern; access mediated by edge function)
DROP POLICY IF EXISTS "bc_scenarios_service_role_all" ON public.bc_scenarios;
CREATE POLICY "bc_scenarios_service_role_all"
ON public.bc_scenarios
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.set_bc_scenarios_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bc_scenarios_updated_at ON public.bc_scenarios;
CREATE TRIGGER trg_bc_scenarios_updated_at
BEFORE UPDATE ON public.bc_scenarios
FOR EACH ROW EXECUTE FUNCTION public.set_bc_scenarios_updated_at();
