-- A saved Portfolio Analysis report may be linked to a client portal once.
-- Existing non-portfolio and historical portal reports remain unchanged.
CREATE UNIQUE INDEX IF NOT EXISTS client_portal_reports_unique_portfolio_source
  ON public.client_portal_reports (client_id, source_report_id)
  WHERE source_report_id IS NOT NULL;
