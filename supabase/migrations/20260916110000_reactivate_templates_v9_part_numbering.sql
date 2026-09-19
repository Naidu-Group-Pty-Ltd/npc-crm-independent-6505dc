-- Refresh the activated templates from the v9 catalogue.
--
-- Same mechanism, and mostly the same words, as 20260816150000 — an activated
-- template is a COPY, and every correction made to the catalogue reaches the
-- library card and not the document until something copies it again. The v9
-- seed this follows fixes the report body's running heads: every narrative
-- continuation page used to mint its own part number, so a Compass ran
-- "Part 08 · Report" through "Part 33 · Report" and the Sources page
-- introduced itself as Part 49 with a two-inch numeral. A continuation is the
-- same part; the labels are baked into each page's furniture in the schema,
-- which is why this needs a schema refresh and not just the code deploy.
--
-- What is copied: `schema` only. `is_active`, `is_default`, `report_type` and
-- the row's identity are the operator's choices and are left exactly as they
-- are. Colourway-activated copies (` · <Colourway>` in the name) self-exclude
-- by the composite-name join, exactly as before — their schemas carry token
-- overrides the base entry does not.
--
-- Idempotent: re-running copies the same bytes.

UPDATE report_templates AS t
SET schema = e.schema,
    updated_at = now()
FROM template_library_entries AS e
WHERE t.is_active
  AND e.status = 'published'
  AND e.report_type = t.report_type
  AND t.name = (e.design_meta->>'familyName') || ' — ' || e.name
  AND t.schema IS DISTINCT FROM e.schema;

DO $$
DECLARE
  stale integer;
  marching integer;
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

  -- The v9 point, probed on the refreshed rows: with one part for the whole
  -- report body, no schema's furniture reaches the teens. The old ones carried
  -- "Part 15" (and far past it) as literal running-head labels.
  SELECT count(*) INTO marching
  FROM report_templates
  WHERE is_active
    AND report_type IN ('investment', 'investment_compass')
    AND name NOT LIKE '% · %'
    AND schema::text LIKE '%Part 15 · Report%';

  IF marching > 0 THEN
    RAISE EXCEPTION '% active investment templates still number each narrative page as its own part', marching;
  END IF;
END $$;
