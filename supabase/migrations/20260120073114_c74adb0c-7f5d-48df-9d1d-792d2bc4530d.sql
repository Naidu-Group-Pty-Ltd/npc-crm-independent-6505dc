-- Create table to cache CDR lending rates
CREATE TABLE IF NOT EXISTS public.bank_lending_rates_cache (
  lender_id TEXT PRIMARY KEY,
  lender_name TEXT NOT NULL,
  rates JSONB NOT NULL DEFAULT '[]',
  fetched_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (now() + INTERVAL '24 hours'),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_bank_lending_rates_expires ON public.bank_lending_rates_cache(expires_at);

-- Enable RLS
ALTER TABLE public.bank_lending_rates_cache ENABLE ROW LEVEL SECURITY;

-- Create policy for public read access (rates are public data)
CREATE POLICY "Bank rates are publicly readable" 
ON public.bank_lending_rates_cache 
FOR SELECT 
USING (true);

-- Create policy for service role write access
CREATE POLICY "Service role can manage bank rates" 
ON public.bank_lending_rates_cache 
FOR ALL 
USING (true)
WITH CHECK (true);

-- Add updated_at trigger
CREATE OR REPLACE TRIGGER update_bank_lending_rates_cache_updated_at
BEFORE UPDATE ON public.bank_lending_rates_cache
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();