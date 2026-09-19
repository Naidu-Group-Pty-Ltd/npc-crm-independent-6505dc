-- MCP Server joins the integration registry, so its credential fields need the
-- same placeholder rows every other integration has. Separate migration rather
-- than an edit to 20260813000000 because that one has already been applied —
-- a seeded migration is history, not a file to keep in sync with the registry.
--
-- Same shape as the original seed: empty values, idempotent, so re-running or
-- applying out of order changes nothing.

BEGIN;

INSERT INTO public.integration_configs (key_name, key_value, integration_id)
SELECT v.key_name, '', v.integration_id
FROM (VALUES
  ('MCP_SERVER_URL', 'mcp'),
  ('MCP_ACCESS_TOKEN', 'mcp')
) AS v(key_name, integration_id)
ON CONFLICT (key_name) DO NOTHING;

COMMIT;
