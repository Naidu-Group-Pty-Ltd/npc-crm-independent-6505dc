-- Workflow Playground — saved automations.
--
-- The graph is stored whole as JSONB rather than normalised into node and edge
-- tables: it is always read and written as one document by the canvas, never
-- queried across workflows, and keeping it in one column means a saved workflow
-- round-trips exactly as the builder wrote it.
--
-- Access mirrors integration_configs: service_role for the edge-function broker,
-- admin and superadmin for direct access. A workflow can invoke any configured
-- integration, so it is administrative data, not per-user content.

BEGIN;

CREATE TABLE IF NOT EXISTS public.workflows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  graph jsonb NOT NULL DEFAULT '{"nodes": [], "edges": []}'::jsonb,
  status text NOT NULL DEFAULT 'draft',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workflows_status_check CHECK (status IN ('draft', 'live', 'paused')),
  CONSTRAINT workflows_name_not_blank CHECK (length(btrim(name)) > 0),
  -- The canvas cannot render a graph missing either collection, so reject it at
  -- the boundary rather than letting the page fail to load.
  CONSTRAINT workflows_graph_shape CHECK (
    jsonb_typeof(graph -> 'nodes') = 'array' AND jsonb_typeof(graph -> 'edges') = 'array'
  )
);

COMMENT ON TABLE public.workflows IS
  'Workflow Playground automations. graph holds the whole node/edge document; see src/lib/workflow/types.ts for the wire format.';

CREATE INDEX IF NOT EXISTS workflows_status_idx ON public.workflows (status);
CREATE INDEX IF NOT EXISTS workflows_updated_at_idx ON public.workflows (updated_at DESC);

-- Keep updated_at honest regardless of which caller writes the row.
CREATE OR REPLACE FUNCTION public.workflows_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS workflows_set_updated_at ON public.workflows;
CREATE TRIGGER workflows_set_updated_at
  BEFORE UPDATE ON public.workflows
  FOR EACH ROW EXECUTE FUNCTION public.workflows_touch_updated_at();

ALTER TABLE public.workflows ENABLE ROW LEVEL SECURITY;

-- Service role: the manage-templates broker, which has already checked the
-- caller's integrations permission before it gets here.
DROP POLICY IF EXISTS workflows_service_role_select ON public.workflows;
CREATE POLICY workflows_service_role_select ON public.workflows
  FOR SELECT TO service_role USING (true);

DROP POLICY IF EXISTS workflows_service_role_insert ON public.workflows;
CREATE POLICY workflows_service_role_insert ON public.workflows
  FOR INSERT TO service_role WITH CHECK (true);

DROP POLICY IF EXISTS workflows_service_role_update ON public.workflows;
CREATE POLICY workflows_service_role_update ON public.workflows
  FOR UPDATE TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS workflows_service_role_delete ON public.workflows;
CREATE POLICY workflows_service_role_delete ON public.workflows
  FOR DELETE TO service_role USING (true);

-- Direct access for administrators, matching integration_configs.
DROP POLICY IF EXISTS "Admins can view workflows" ON public.workflows;
CREATE POLICY "Admins can view workflows" ON public.workflows
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role = ANY (ARRAY['superadmin'::public.app_role, 'admin'::public.app_role])
    )
  );

DROP POLICY IF EXISTS "Admins can create workflows" ON public.workflows;
CREATE POLICY "Admins can create workflows" ON public.workflows
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role = ANY (ARRAY['superadmin'::public.app_role, 'admin'::public.app_role])
    )
  );

DROP POLICY IF EXISTS "Admins can update workflows" ON public.workflows;
CREATE POLICY "Admins can update workflows" ON public.workflows
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role = ANY (ARRAY['superadmin'::public.app_role, 'admin'::public.app_role])
    )
  );

DROP POLICY IF EXISTS "Admins can delete workflows" ON public.workflows;
CREATE POLICY "Admins can delete workflows" ON public.workflows
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role = ANY (ARRAY['superadmin'::public.app_role, 'admin'::public.app_role])
    )
  );

COMMIT;
