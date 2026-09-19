-- Add toggle column to portfolio_reviews table
ALTER TABLE public.portfolio_reviews 
ADD COLUMN IF NOT EXISTS include_owner_occupied boolean NOT NULL DEFAULT true;

-- Add comment for documentation
COMMENT ON COLUMN public.portfolio_reviews.include_owner_occupied IS 'When false, owner-occupied properties are excluded from portfolio-level calculations (value, debt, equity, LVR, cashflow scores) but still shown in property list for reference';