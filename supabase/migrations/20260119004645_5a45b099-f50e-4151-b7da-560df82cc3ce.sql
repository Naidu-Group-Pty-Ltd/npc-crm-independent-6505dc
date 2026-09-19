-- Add review frequency to clients table
ALTER TABLE public.clients 
ADD COLUMN IF NOT EXISTS review_frequency TEXT DEFAULT 'annual' CHECK (review_frequency IN ('quarterly', 'bi_annual', 'annual')),
ADD COLUMN IF NOT EXISTS last_review_date TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS next_review_due TIMESTAMP WITH TIME ZONE;

-- Create portfolio_reviews table for review history
CREATE TABLE public.portfolio_reviews (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  reviewer_id UUID REFERENCES public.custom_users(id),
  review_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'in_progress', 'pending_approval', 'completed')),
  review_frequency TEXT NOT NULL CHECK (review_frequency IN ('quarterly', 'bi_annual', 'annual')),
  
  -- Scores at time of review
  overall_score INTEGER,
  portfolio_health INTEGER,
  cash_flow_score INTEGER,
  growth_potential INTEGER,
  risk_level TEXT,
  
  -- Data quality metrics
  data_completeness_score INTEGER,
  data_issues JSONB DEFAULT '[]'::jsonb,
  
  -- Validation flags
  validation_flags JSONB DEFAULT '[]'::jsonb,
  
  -- Findings and recommendations
  executive_summary TEXT,
  key_findings JSONB DEFAULT '[]'::jsonb,
  recommendations JSONB DEFAULT '[]'::jsonb,
  action_items JSONB DEFAULT '[]'::jsonb,
  
  -- Property-level scores
  property_scores JSONB DEFAULT '[]'::jsonb,
  
  -- Scenarios run
  scenarios JSONB DEFAULT '[]'::jsonb,
  
  -- Next review
  next_review_due TIMESTAMP WITH TIME ZONE,
  
  -- Metadata
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.portfolio_reviews ENABLE ROW LEVEL SECURITY;

-- RLS Policies for portfolio_reviews
CREATE POLICY "Anyone can view portfolio reviews" 
ON public.portfolio_reviews 
FOR SELECT 
USING (true);

CREATE POLICY "Anyone can insert portfolio reviews" 
ON public.portfolio_reviews 
FOR INSERT 
WITH CHECK (true);

CREATE POLICY "Anyone can update portfolio reviews" 
ON public.portfolio_reviews 
FOR UPDATE 
USING (true);

CREATE POLICY "Anyone can delete portfolio reviews" 
ON public.portfolio_reviews 
FOR DELETE 
USING (true);

-- Create indexes for efficient queries
CREATE INDEX idx_portfolio_reviews_client_id ON public.portfolio_reviews(client_id);
CREATE INDEX idx_portfolio_reviews_status ON public.portfolio_reviews(status);
CREATE INDEX idx_portfolio_reviews_next_review_due ON public.portfolio_reviews(next_review_due);
CREATE INDEX idx_clients_next_review_due ON public.clients(next_review_due);

-- Trigger for updated_at
CREATE TRIGGER update_portfolio_reviews_updated_at
BEFORE UPDATE ON public.portfolio_reviews
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();