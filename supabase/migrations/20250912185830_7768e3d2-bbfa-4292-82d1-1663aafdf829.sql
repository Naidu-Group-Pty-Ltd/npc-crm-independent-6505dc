-- Add sources_content column to investment_reports table
ALTER TABLE public.investment_reports 
ADD COLUMN sources_content TEXT;