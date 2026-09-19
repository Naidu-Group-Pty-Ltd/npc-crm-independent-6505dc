-- Refresh the activated templates from the catalogue they were copied from.
--
-- ## An activated template is a COPY
--
-- A document is drawn from `report_templates`. A catalogue entry is copied into
-- that table when an operator activates it, and nothing has ever copied it
-- again. So every correction made to the catalogue since — and there have been
-- several this month — reached the library card and not the document.
--
-- Measured 2026-08-16, immediately after v8 applied: of the thirteen active
-- rows, ten match a published catalogue entry by name and report type, and
-- **not one of the ten is identical to it**. Two defects already traced to this
-- exact gap:
--
--   * `Prepared 2026-08-16T08:58:56.946Z` on a Client Details cover. The
--     masters had bound `{{report.generatedDate | date}}` since ad99bc228; the
--     activated copy still bound it raw.
--   * The Investment Compass drew none of the report the model wrote. v8 adds
--     the narrative pages; without this the activated copy would not have them.
--
-- ## What is copied, and what is not
--
-- `schema` only. That is the page sequence, the blocks and the bindings — the
-- thing that goes stale and the thing a correction changes. `is_active`,
-- `is_default`, `report_type` and the row's identity are the operator's
-- choices and are left exactly as they are: this refreshes what an activated
-- template says, never which template is activated.
--
-- ## Three rows are deliberately not touched
--
--   * `Architectural Property — Datum · Limewash` (borrowing_capacity)
--   * `Institutional Research — Exhibit Dense · Rust Console` (client_details)
--
--     Activated with a colourway applied — the ` · <Colourway>` suffix is the
--     tell — so their schemas carry token overrides the base catalogue entry
--     does not. Copying the base over them would silently discard the operator's
--     colourway choice, which is a visible change nobody asked for. Refreshing
--     these needs the activation path's own colourway step, not this statement.
--
--   * `Investment Compass — WeasyPrint Pilot` — a one-off that came from no
--     catalogue entry. There is nothing to refresh it from.
--
-- Idempotent: re-running copies the same bytes. The join is on the composite
-- name the activation path writes, `<family> — <variant>`, which is why the
-- three above do not match and are excluded by the join rather than by a list.

UPDATE report_templates AS t
SET schema = e.schema,
    updated_at = now()
FROM template_library_entries AS e
WHERE t.is_active
  AND e.status = 'published'
  AND e.report_type = t.report_type
  AND t.name = (e.design_meta->>'familyName') || ' — ' || e.name
  AND t.schema IS DISTINCT FROM e.schema;

-- Every active row that CAN be refreshed now matches its entry byte for byte.
--
-- Asserted rather than assumed, because a partial copy is the failure this
-- migration exists to end: a template that is half-current reads as current.
DO $$
DECLARE
  stale integer;
  refreshed integer;
BEGIN
  SELECT count(*) INTO stale
  FROM report_templates t
  JOIN template_library_entries e
    ON e.status = 'published'
   AND e.report_type = t.report_type
   AND t.name = (e.design_meta->>'familyName') || ' — ' || e.name
  WHERE t.is_active AND t.schema IS DISTINCT FROM e.schema;

  IF stale > 0 THEN
    RAISE EXCEPTION '% active templates still differ from their catalogue entry', stale;
  END IF;

  -- And the Investment Compass one carries the narrative pages, which is the
  -- whole point of the v8 seed this follows.
  SELECT count(*) INTO refreshed
  FROM report_templates
  WHERE is_active
    AND report_type = 'investment_compass'
    AND schema::text LIKE '%narrative.source%';

  IF refreshed < 1 THEN
    RAISE EXCEPTION 'no active investment_compass template carries the report narrative';
  END IF;
END $$;
