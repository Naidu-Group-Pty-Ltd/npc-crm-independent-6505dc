ALTER TABLE public.template_library_entries
  DROP CONSTRAINT IF EXISTS template_library_entries_category_check;

ALTER TABLE public.template_library_entries
  ADD CONSTRAINT template_library_entries_category_check
  CHECK (category IN ('investment', 'suburb', 'postcode', 'statewide',
                      'comparison', 'cash_flow', 'client_form', 'compliance',
                      'finance', 'portfolio'));