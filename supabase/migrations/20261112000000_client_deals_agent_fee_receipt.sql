-- An agent fee had no way to be marked received.
--
-- A house-and-land deal earns its commission stage by stage, and each stage is
-- a `build_progress_payments` row carrying `commission_received` /
-- `commission_received_date`. An existing-property purchase and a refinance
-- earn a single agent fee on the deal itself — and `client_deals` has always
-- carried `commission_estimate`, `trail_commission` and the clawback window
-- with nowhere to record that the money actually arrived.
--
-- So the whole commission apparatus (the client's Commission / invoice
-- section, the pipeline's Commission Dashboard, Total Received) was built out
-- of build payments alone, and a deal type that has none contributed nothing
-- to any of it. That is why two consecutive audits reported "there is
-- currently no agent fee/commission tracking".
--
-- The two columns mirror the build-payment pair exactly, so one rule reads
-- both: the flag says whether it was received, the date says when.
ALTER TABLE public.client_deals
  ADD COLUMN IF NOT EXISTS commission_received BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS commission_received_date DATE;

COMMENT ON COLUMN public.client_deals.commission_received IS
  'Whether the single agent fee / upfront commission on this deal has been received. House-and-land deals are paid per build stage and record receipt on build_progress_payments instead; this column stays false for them.';

COMMENT ON COLUMN public.client_deals.commission_received_date IS
  'The day the agent fee was received. Null while commission_received is false — the flag and the date are set and cleared together.';
