-- Create table for storing chart analysis
CREATE TABLE public.chart_analysis (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  chart_id UUID NOT NULL REFERENCES public.charts(id) ON DELETE CASCADE,
  analysis_text TEXT NOT NULL,
  model_used TEXT DEFAULT 'gpt-4o-mini',
  confidence_score DECIMAL(3,2),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.chart_analysis ENABLE ROW LEVEL SECURITY;

-- Create policies for chart analysis access (inherit from charts table permissions)
CREATE POLICY "Users can view analysis for their own charts"
ON public.chart_analysis
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.charts
    JOIN public.generated_reports ON charts.report_id = generated_reports.id
    WHERE charts.id = chart_analysis.chart_id 
    AND generated_reports.generated_by = auth.uid()
  )
);

CREATE POLICY "Users can create analysis for their own charts"
ON public.chart_analysis
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.charts
    JOIN public.generated_reports ON charts.report_id = generated_reports.id
    WHERE charts.id = chart_analysis.chart_id 
    AND generated_reports.generated_by = auth.uid()
  )
);

CREATE POLICY "Users can update analysis for their own charts"
ON public.chart_analysis
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.charts
    JOIN public.generated_reports ON charts.report_id = generated_reports.id
    WHERE charts.id = chart_analysis.chart_id 
    AND generated_reports.generated_by = auth.uid()
  )
);

CREATE POLICY "Users can delete analysis for their own charts"
ON public.chart_analysis
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.charts
    JOIN public.generated_reports ON charts.report_id = generated_reports.id
    WHERE charts.id = chart_analysis.chart_id 
    AND generated_reports.generated_by = auth.uid()
  )
);

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_chart_analysis_updated_at
BEFORE UPDATE ON public.chart_analysis
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create index for better performance
CREATE INDEX idx_chart_analysis_chart_id ON public.chart_analysis(chart_id);