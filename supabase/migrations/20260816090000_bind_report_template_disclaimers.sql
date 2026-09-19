-- =====================================================================
-- Bind every `report_templates` disclaimer to the deployment's own text.
--
-- ## What this fixes
--
-- The Report Settings page in the Command Centre writes
-- `global_report_settings.professional_disclaimer` — 1,341 characters over
-- nine paragraphs on this deployment. `org.disclaimer` publishes it, and v7
-- (20260815170000) bound all 543 `template_library_entries` to it: every one
-- carries `disclaimerText = '{{org.disclaimer}}'` and
-- `fontSize = '{{org.disclaimerFontSize}}'`, each with a fallback.
--
-- `report_templates` is a different table, and it is the one a document is
-- actually drawn from. Its rows are COPIES taken at a moment in time:
-- `20260814190000_activate_production_masters_eight_formats` inserted
-- `e.schema` verbatim on 14 Aug and v7 landed on the 15th. So the catalogue was
-- corrected and the activated templates kept the pre-v7 wording.
--
-- Measured on this database before this migration:
--
--     disclaimer blocks in report_templates   13
--       bound to {{org.disclaimer}}            2
--       baked literal                         11   (one identical 415-char text)
--       of those, on an ACTIVE template       10
--
-- Two of the three formats an operator had chosen a template for —
-- `client_details` and `cashflow` — were among the baked ones. Editing the
-- settings page changed nothing on those documents, which is the reported
-- behaviour.
--
-- `disclaimer.html.ts` cannot rescue this: it resolves `disclaimerText` and
-- only reaches `disclaimerFallback` when the result is empty. That is correct,
-- and it is exactly why a literal wins for ever once it is in the row.
--
-- ## What it does
--
-- Binds the text and the size, and DEMOTES the literal to the fallback rather
-- than dropping it. Nothing is lost: a deployment with no disclaimer set, or
-- one that has switched it off, prints exactly what it prints today, because
-- that text is now the fallback instead of the value.
--
-- The 415-character literal on all 11 rows is byte-identical to the fallback
-- the library already ships, so this converges them rather than inventing text.
--
-- `fontSizeFallback` is the token `small`. The masters passed the number `8`,
-- which matches none of `small|medium|large` and fell through to 8.5pt in the
-- renderer — the same point size `small` produces. The size on the page does
-- not move.
--
-- IDEMPOTENT: a block already bound is left exactly as it is, and a fallback
-- that is already set is never overwritten. Re-running changes nothing.
--
-- The same rule is enforced going forward in
-- `_shared/reports/disclaimerBinding.pure.ts`, which `buildWorkingCopyPayload`
-- applies to every new copy — so a template activated from a stale entry, an
-- old export, or an operator's paste cannot reintroduce this.
-- =====================================================================

BEGIN;

WITH rewritten AS (
  SELECT
    t.id,
    jsonb_set(
      t.schema,
      '{pages}',
      coalesce((
        SELECT jsonb_agg(
          CASE
            WHEN jsonb_typeof(page->'blocks') <> 'array' THEN page
            ELSE jsonb_set(
              page,
              '{blocks}',
              -- `jsonb_agg` over zero rows is NULL, and `jsonb_set` is STRICT:
              -- without this coalesce a page whose `blocks` array is empty
              -- rewrites to NULL and takes the whole schema with it. Nine rows
              -- in this table have such a page. None of them is one this
              -- migration targets, but a rewrite that depends on that
              -- coincidence is a trap for whoever copies this pattern next.
              coalesce((
                SELECT jsonb_agg(
                  CASE
                    WHEN block->>'type' <> 'disclaimer' THEN block
                    ELSE jsonb_set(
                      block,
                      '{props}',
                      coalesce(block->'props', '{}'::jsonb)
                      -- Preserve the literal as the fallback, but never over an
                      -- authored one that is already present.
                      || CASE
                           WHEN coalesce(block->'props'->>'disclaimerText','') NOT LIKE '%{{%'
                            AND coalesce(btrim(block->'props'->>'disclaimerText'),'') <> ''
                            AND coalesce(btrim(block->'props'->>'disclaimerFallback'),'') = ''
                           THEN jsonb_build_object('disclaimerFallback', block->'props'->>'disclaimerText')
                           ELSE '{}'::jsonb
                         END
                      || CASE
                           WHEN coalesce(block->'props'->>'fontSize','') NOT LIKE '%{{%'
                            AND coalesce(btrim(block->'props'->>'fontSizeFallback'),'') = ''
                           THEN jsonb_build_object('fontSizeFallback', 'small')
                           ELSE '{}'::jsonb
                         END
                      -- Then bind, leaving an already-bound prop untouched.
                      || CASE
                           WHEN coalesce(block->'props'->>'disclaimerText','') NOT LIKE '%{{%'
                           THEN jsonb_build_object('disclaimerText', '{{org.disclaimer}}')
                           ELSE '{}'::jsonb
                         END
                      || CASE
                           WHEN coalesce(block->'props'->>'fontSize','') NOT LIKE '%{{%'
                           THEN jsonb_build_object('fontSize', '{{org.disclaimerFontSize}}')
                           ELSE '{}'::jsonb
                         END
                    )
                  END
                  ORDER BY block_index
                )
                FROM jsonb_array_elements(page->'blocks') WITH ORDINALITY AS blk(block, block_index)
              ), '[]'::jsonb)
            )
          END
          ORDER BY page_index
        )
        FROM jsonb_array_elements(t.schema->'pages') WITH ORDINALITY AS pg(page, page_index)
      ), '[]'::jsonb)
    ) AS next_schema
  FROM public.report_templates t
  WHERE jsonb_typeof(t.schema->'pages') = 'array'
    -- Only rows that actually carry an unbound disclaimer, so `updated_at` does
    -- not move on templates that were already correct.
    AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(t.schema->'pages') p,
           jsonb_array_elements(coalesce(p->'blocks','[]'::jsonb)) b
      WHERE b->>'type' = 'disclaimer'
        AND (coalesce(b->'props'->>'disclaimerText','') NOT LIKE '%{{%'
          OR coalesce(b->'props'->>'fontSize','') NOT LIKE '%{{%')
    )
)
UPDATE public.report_templates t
SET schema = r.next_schema,
    updated_at = now()
FROM rewritten r
WHERE t.id = r.id
  AND t.schema IS DISTINCT FROM r.next_schema;

-- Refuse to finish if any disclaimer block is still unbound. A partially
-- converted catalogue is worse than a failed migration: it looks fixed on the
-- formats somebody happens to open.
DO $$
DECLARE
  unbound integer;
BEGIN
  SELECT count(*) INTO unbound
  FROM public.report_templates t,
       jsonb_array_elements(coalesce(t.schema->'pages','[]'::jsonb)) p,
       jsonb_array_elements(coalesce(p->'blocks','[]'::jsonb)) b
  WHERE b->>'type' = 'disclaimer'
    AND (coalesce(b->'props'->>'disclaimerText','') NOT LIKE '%{{%'
      OR coalesce(b->'props'->>'fontSize','') NOT LIKE '%{{%');

  IF unbound > 0 THEN
    RAISE EXCEPTION
      'bind_report_template_disclaimers: % disclaimer block(s) still carry a literal', unbound;
  END IF;
END $$;

COMMIT;
