
-- Add income fields to client_employment table
ALTER TABLE public.client_employment
  ADD COLUMN IF NOT EXISTS salary_amount numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS salary_frequency text DEFAULT 'annual',
  ADD COLUMN IF NOT EXISTS gross_annual_salary numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bonus numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS commission numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS overtime_essential numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS overtime_non_essential numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS allowance numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS other_taxable_income numeric DEFAULT 0;

-- Add employment_id FK to client_income_sources for relational linkage
ALTER TABLE public.client_income_sources
  ADD COLUMN IF NOT EXISTS employment_id uuid REFERENCES public.client_employment(id) ON DELETE CASCADE;

-- Add additional_contact_id FK to client_employment for contacts beyond primary/secondary
ALTER TABLE public.client_employment
  ADD COLUMN IF NOT EXISTS additional_contact_id uuid REFERENCES public.client_additional_contacts(id) ON DELETE SET NULL;

-- Add additional_contact_id FK to client_income_sources for contacts beyond primary/secondary
ALTER TABLE public.client_income_sources
  ADD COLUMN IF NOT EXISTS additional_contact_id uuid REFERENCES public.client_additional_contacts(id) ON DELETE SET NULL;

-- Index for quick lookup of income sources linked to employment
CREATE INDEX IF NOT EXISTS idx_income_sources_employment_id ON public.client_income_sources(employment_id);
CREATE INDEX IF NOT EXISTS idx_income_sources_additional_contact ON public.client_income_sources(additional_contact_id);
CREATE INDEX IF NOT EXISTS idx_employment_additional_contact ON public.client_employment(additional_contact_id);
