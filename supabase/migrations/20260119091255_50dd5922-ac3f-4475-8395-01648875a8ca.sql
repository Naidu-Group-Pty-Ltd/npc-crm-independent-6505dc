-- Create ghl_pipelines table to store GHL pipelines
CREATE TABLE public.ghl_pipelines (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ghl_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  position INTEGER DEFAULT 0,
  location_id TEXT,
  is_active BOOLEAN DEFAULT true,
  synced_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create ghl_pipeline_stages table to store stages within pipelines
CREATE TABLE public.ghl_pipeline_stages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ghl_id TEXT NOT NULL UNIQUE,
  pipeline_id UUID NOT NULL REFERENCES public.ghl_pipelines(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position INTEGER DEFAULT 0,
  color TEXT DEFAULT '#6B7280',
  synced_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Add new columns to clients table for proper GHL opportunity tracking
ALTER TABLE public.clients 
ADD COLUMN IF NOT EXISTS ghl_opportunity_id TEXT,
ADD COLUMN IF NOT EXISTS current_pipeline_id UUID REFERENCES public.ghl_pipelines(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS current_stage_id UUID REFERENCES public.ghl_pipeline_stages(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS opportunity_status TEXT DEFAULT 'open';

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_ghl_pipelines_ghl_id ON public.ghl_pipelines(ghl_id);
CREATE INDEX IF NOT EXISTS idx_ghl_pipeline_stages_ghl_id ON public.ghl_pipeline_stages(ghl_id);
CREATE INDEX IF NOT EXISTS idx_ghl_pipeline_stages_pipeline_id ON public.ghl_pipeline_stages(pipeline_id);
CREATE INDEX IF NOT EXISTS idx_clients_ghl_opportunity_id ON public.clients(ghl_opportunity_id);
CREATE INDEX IF NOT EXISTS idx_clients_current_pipeline_id ON public.clients(current_pipeline_id);
CREATE INDEX IF NOT EXISTS idx_clients_current_stage_id ON public.clients(current_stage_id);

-- Enable RLS on new tables
ALTER TABLE public.ghl_pipelines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ghl_pipeline_stages ENABLE ROW LEVEL SECURITY;

-- Create policies for read access (pipelines are viewable by all authenticated users)
CREATE POLICY "Pipelines are viewable by authenticated users" 
ON public.ghl_pipelines 
FOR SELECT 
USING (true);

CREATE POLICY "Pipeline stages are viewable by authenticated users" 
ON public.ghl_pipeline_stages 
FOR SELECT 
USING (true);

-- Create policies for insert/update (typically done by edge functions with service role)
CREATE POLICY "Service role can manage pipelines" 
ON public.ghl_pipelines 
FOR ALL 
USING (true);

CREATE POLICY "Service role can manage pipeline stages" 
ON public.ghl_pipeline_stages 
FOR ALL 
USING (true);

-- Add trigger for updated_at on ghl_pipelines
CREATE TRIGGER update_ghl_pipelines_updated_at
BEFORE UPDATE ON public.ghl_pipelines
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Add trigger for updated_at on ghl_pipeline_stages  
CREATE TRIGGER update_ghl_pipeline_stages_updated_at
BEFORE UPDATE ON public.ghl_pipeline_stages
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Add comments for documentation
COMMENT ON TABLE public.ghl_pipelines IS 'Stores GoHighLevel pipelines synced from GHL API';
COMMENT ON TABLE public.ghl_pipeline_stages IS 'Stores stages within each GHL pipeline';
COMMENT ON COLUMN public.clients.ghl_opportunity_id IS 'GHL opportunity ID linked to this client';
COMMENT ON COLUMN public.clients.current_pipeline_id IS 'Current pipeline the client opportunity is in';
COMMENT ON COLUMN public.clients.current_stage_id IS 'Current stage within the pipeline';