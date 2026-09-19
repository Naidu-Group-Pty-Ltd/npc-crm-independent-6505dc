-- Create client_expenses table for tracking individual living expenses
CREATE TABLE public.client_expenses (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  expense_category TEXT NOT NULL,
  expense_name TEXT,
  monthly_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  frequency TEXT DEFAULT 'monthly',
  notes TEXT,
  is_essential BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.client_expenses ENABLE ROW LEVEL SECURITY;

-- Create policies for authenticated user access
CREATE POLICY "Authenticated users can view client expenses" 
ON public.client_expenses 
FOR SELECT 
USING (true);

CREATE POLICY "Authenticated users can create client expenses" 
ON public.client_expenses 
FOR INSERT 
WITH CHECK (true);

CREATE POLICY "Authenticated users can update client expenses" 
ON public.client_expenses 
FOR UPDATE 
USING (true);

CREATE POLICY "Authenticated users can delete client expenses" 
ON public.client_expenses 
FOR DELETE 
USING (true);

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_client_expenses_updated_at
BEFORE UPDATE ON public.client_expenses
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create index for faster lookups
CREATE INDEX idx_client_expenses_client_id ON public.client_expenses(client_id);