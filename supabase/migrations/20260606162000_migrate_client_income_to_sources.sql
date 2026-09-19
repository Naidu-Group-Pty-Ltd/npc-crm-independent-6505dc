-- #14 Income unification: the Command Center uses client_income_sources (rich
-- model) while the Finance Portal historically wrote client_income (legacy).
-- The Finance Portal now also reads/writes client_income_sources. This migration
-- backfills legacy client_income rows into client_income_sources so previously
-- finance-portal-entered income shows up in the Command Center Financial tab.
--
-- Conservative: only migrate clients that have NO client_income_sources rows yet,
-- so we never duplicate income for clients already using the rich model.
INSERT INTO public.client_income_sources (
  client_id, contact_type, source_category, source_type, source_name,
  gross_annual_amount, input_frequency, input_amount,
  bonus, commission, overtime_essential, overtime_non_essential,
  allowance, other_taxable_income,
  default_shading_rate, is_active, display_order, notes
)
SELECT
  ci.client_id,
  COALESCE(NULLIF(ci.contact_type, ''), 'primary'),
  'employment',
  'payg_fulltime',
  NULL,
  CASE lower(COALESCE(ci.salary_frequency, 'annual'))
    WHEN 'weekly'      THEN COALESCE(ci.gross_salary, 0) * 52
    WHEN 'fortnightly' THEN COALESCE(ci.gross_salary, 0) * 26
    WHEN 'monthly'     THEN COALESCE(ci.gross_salary, 0) * 12
    ELSE COALESCE(ci.gross_salary, 0)
  END,
  CASE
    WHEN lower(COALESCE(ci.salary_frequency, 'annual')) IN ('weekly', 'fortnightly', 'monthly')
    THEN lower(ci.salary_frequency)
    ELSE 'annual'
  END,
  COALESCE(ci.gross_salary, 0),
  COALESCE(ci.bonus, 0),
  COALESCE(ci.commission, 0),
  COALESCE(ci.overtime_essential, 0),
  COALESCE(ci.overtime_non_essential, 0),
  COALESCE(ci.allowance, 0),
  COALESCE(ci.other_taxable_income, 0),
  1.0,
  true,
  0,
  'Migrated from legacy finance portal income'
FROM public.client_income ci
WHERE NOT EXISTS (
  SELECT 1 FROM public.client_income_sources s WHERE s.client_id = ci.client_id
);
