-- Critical dates could be set but never finished: once a date passed it read
-- "Overdue by Nd" forever — on the client's deal card and again in the deal
-- pipeline's executive summary settlement column — because nothing recorded
-- that the obligation was met. The stamps live per date column, so each of
-- the twelve tracked dates completes independently and reopening one is
-- deleting its key, never touching the date itself.
ALTER TABLE public.client_deals
  ADD COLUMN IF NOT EXISTS critical_date_completions JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.client_deals.critical_date_completions IS
  'Completion stamps for critical date fields, keyed by column name ({"settlement_date": "2026-09-02"}). A key''s presence means the obligation was met; its value is the day it was marked complete.';
