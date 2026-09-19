UPDATE client_portal_reports
SET client_visible_notes = notes
WHERE client_id = '4d2743bf-968e-4797-ab3f-bb5cc794a566'
  AND notes IS NOT NULL
  AND client_visible_notes IS NULL;