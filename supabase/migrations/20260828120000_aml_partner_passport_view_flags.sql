-- The Compliance Passport, inside a partner's own portal.
--
-- Two flags, and the relationship between them is the safety property.
--
-- `aml_partner_passport_view` NARROWS the partner compliance page to the
-- Passport document alone. That is deliberate: the shared Phase 4 workspace
-- carries eight panels chosen by a static per-portal adapter rather than by a
-- flag, so enabling the workspace merely in order to show a Passport would
-- light every one of them at once — on a deployment where their write flags
-- (aml_partner_records_requests_write, aml_partner_determinations_write,
-- aml_partner_evidence_delivery_write) are separately off and several would
-- render and then refuse.
--
-- `aml_partner_workspace_full` is the second, later switch that restores the
-- complete surface once it has been reviewed.
--
--   passport | full | the page is
--   ---------|------|---------------------------------
--   off      | off  | full  (today, byte for byte)
--   ON       | off  | the Passport, and only that
--   ON       | ON   | full, Passport included
--   off      | ON   | full  (today)
--
-- The off/off row is why this migration cannot change behaviour on a
-- deployment that has already enabled the workspace: passport_only is never
-- reachable by omission. Both default false; neither is sufficient on its own,
-- because aml_partner_compliance_workspace and the per-surface flag still gate
-- whether the page exists at all.
INSERT INTO public.feature_flags (key, value, description)
VALUES
  (
    'aml_partner_passport_view',
    'false'::jsonb,
    'Compliance Passport: serve the partner-audience Passport document inside the partner''s own portal compliance page (get_partner_compliance_workspace on aml-reliance). The SAME buildCasePassportView(..., "partner") projection the emailed one-time link serves — one assembler, so the partner''s copy and the Command Centre''s cannot drift. Turning this ON narrows the compliance page to the Passport alone unless aml_partner_workspace_full is also on. Off = no Passport is returned and the page behaves exactly as before. Requires aml_partner_compliance_workspace and the per-surface flag.'
  ),
  (
    'aml_partner_workspace_full',
    'false'::jsonb,
    'AML partner domain: restore the COMPLETE Phase 4 partner compliance workspace (summary, task rail, procedure evidence, independent determination, records requests, evidence deliveries, audit receipt, clarification) alongside the Passport. Off with aml_partner_passport_view on = the Passport only. Off with aml_partner_passport_view off = the workspace behaves exactly as it did before the Passport surface existed. The per-portal adapter remains the ceiling: this flag can never show a panel a portal never permitted.'
  )
ON CONFLICT (key) DO NOTHING;
