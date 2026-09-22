-- Restore the least-privilege template for databases where
-- 20260609045222_c76af632-fca8-485f-a61c-c84c4d0d9950.sql was already applied.
-- Restrict the update to the exact all-full template installed by that migration
-- so administrator-customized defaults created since then remain untouched.
UPDATE public.finance_portal_default_permissions
SET permissions = jsonb_build_object(
  'properties',  jsonb_build_object('view', true, 'edit', false, 'delete', false),
  'income',      jsonb_build_object('view', true, 'edit', false, 'delete', false),
  'expenses',    jsonb_build_object('view', true, 'edit', false, 'delete', false),
  'assets',      jsonb_build_object('view', true, 'edit', false, 'delete', false),
  'liabilities', jsonb_build_object('view', true, 'edit', false, 'delete', false),
  'employment',  jsonb_build_object('view', true, 'edit', false, 'delete', false),
  'notes',       jsonb_build_object('view', true, 'edit', false, 'delete', false),
  'contacts',    jsonb_build_object('view', true, 'edit', false, 'delete', false)
),
updated_at = now()
WHERE permissions = jsonb_build_object(
  'properties',  jsonb_build_object('view', true, 'edit', true, 'delete', true),
  'income',      jsonb_build_object('view', true, 'edit', true, 'delete', true),
  'expenses',    jsonb_build_object('view', true, 'edit', true, 'delete', true),
  'assets',      jsonb_build_object('view', true, 'edit', true, 'delete', true),
  'liabilities', jsonb_build_object('view', true, 'edit', true, 'delete', true),
  'employment',  jsonb_build_object('view', true, 'edit', true, 'delete', true),
  'notes',       jsonb_build_object('view', true, 'edit', true, 'delete', true),
  'contacts',    jsonb_build_object('view', true, 'edit', true, 'delete', true)
);

-- The escalation discarded the former edit/delete values, so they cannot be
-- reconstructed. Fail closed for matrices matching its all-full output while
-- retaining the existing keys and view access; administrators can explicitly
-- re-grant write access through the permission matrix.
UPDATE public.finance_portal_client_assignments AS assignment
SET permissions = (
  SELECT jsonb_object_agg(
    entry.key,
    jsonb_build_object('view', true, 'edit', false, 'delete', false)
  )
  FROM jsonb_each(assignment.permissions) AS entry(key, value)
),
updated_at = now()
WHERE permissions IS NOT NULL
  AND jsonb_typeof(permissions) = 'object'
  AND permissions <> '{}'::jsonb
  AND NOT EXISTS (
    SELECT 1
    FROM jsonb_each(assignment.permissions) AS entry(key, value)
    WHERE entry.value <> jsonb_build_object('view', true, 'edit', true, 'delete', true)
  );
