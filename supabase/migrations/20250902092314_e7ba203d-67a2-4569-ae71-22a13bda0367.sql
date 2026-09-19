-- Create charts table linked to generated reports
CREATE TABLE public.charts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  report_id UUID NOT NULL REFERENCES public.generated_reports(id) ON DELETE CASCADE,
  chart_type TEXT NOT NULL CHECK (chart_type IN ('bar', 'pie', 'line', 'scatter')),
  title TEXT NOT NULL,
  image_data TEXT NOT NULL, -- Base64 encoded image
  chart_config JSONB, -- Configuration and data used to generate the chart
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.charts ENABLE ROW LEVEL SECURITY;

-- Create policies for charts access
CREATE POLICY "Users can view charts from their own reports" 
ON public.charts 
FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM public.generated_reports 
    WHERE id = charts.report_id AND generated_by = auth.uid()
  )
);

CREATE POLICY "Users can create charts for their own reports" 
ON public.charts 
FOR INSERT 
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.generated_reports 
    WHERE id = charts.report_id AND generated_by = auth.uid()
  )
);

CREATE POLICY "Users can update charts from their own reports" 
ON public.charts 
FOR UPDATE 
USING (
  EXISTS (
    SELECT 1 FROM public.generated_reports 
    WHERE id = charts.report_id AND generated_by = auth.uid()
  )
);

CREATE POLICY "Users can delete charts from their own reports" 
ON public.charts 
FOR DELETE 
USING (
  EXISTS (
    SELECT 1 FROM public.generated_reports 
    WHERE id = charts.report_id AND generated_by = auth.uid()
  )
);

-- Add trigger for automatic timestamp updates
CREATE TRIGGER update_charts_updated_at
BEFORE UPDATE ON public.charts
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create indexes for better performance
CREATE INDEX idx_charts_report_id ON public.charts(report_id);
CREATE INDEX idx_charts_chart_type ON public.charts(chart_type);
CREATE INDEX idx_charts_created_at ON public.charts(created_at);

-- Add comment for documentation
COMMENT ON TABLE public.charts IS 'Stores individual chart images generated for reports';