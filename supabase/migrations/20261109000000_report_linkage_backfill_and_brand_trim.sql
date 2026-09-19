-- Reporting engine closing pass: two data-hygiene repairs the code fixes
-- around them made safe.
--
-- 1. Sub-report linkage. `parent_report_id` and `derived_from_report_id`
--    were written by different engines for the same relationship (audit F9):
--    measured 2026-09-02, 48 rows carry only the parent column, 20 only the
--    derived column, and 0 rows disagree where both are set. Every reader
--    already resolves the union (`familyOf`, the family notice, the render
--    routes), so this changes no reading — it makes the record coherent, so
--    a future reader that consults one column is not wrong.
--
-- 2. Brand identity. `whitelabel_settings.company_name` carries a trailing
--    space in production (audit F15); `manage-branding` now trims at the
--    write boundary, and this brings the existing row to what every reader
--    was already trimming it to.
--
-- Both statements are idempotent and touch nothing else.

update public.investment_reports
set derived_from_report_id = parent_report_id
where derived_from_report_id is null
  and parent_report_id is not null;

update public.investment_reports
set parent_report_id = derived_from_report_id
where parent_report_id is null
  and derived_from_report_id is not null;

update public.whitelabel_settings
set company_name = btrim(company_name)
where company_name is not null
  and company_name <> btrim(company_name);
