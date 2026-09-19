-- Create the missing update function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create tables for dynamic QuickChart integration

-- Report templates for reusable configurations
CREATE TABLE public.report_templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  config JSONB NOT NULL,
  is_default BOOLEAN DEFAULT false,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Chart configurations with QuickChart templates
CREATE TABLE public.chart_configurations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  chart_type TEXT NOT NULL, -- 'bar', 'pie', 'line', 'scatter'
  template_name TEXT NOT NULL,
  quickchart_config JSONB NOT NULL,
  default_styling JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Generated reports history
CREATE TABLE public.generated_reports (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  config JSONB NOT NULL,
  kpis JSONB NOT NULL,
  analytics JSONB NOT NULL,
  insights JSONB NOT NULL,
  chart_urls JSONB NOT NULL,
  listing_count INTEGER NOT NULL,
  generated_by UUID REFERENCES auth.users(id),
  webhook_sent BOOLEAN DEFAULT false,
  webhook_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- User preferences for branding and styling
CREATE TABLE public.user_preferences (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) UNIQUE,
  company_name TEXT,
  author_name TEXT,
  brand_colors JSONB, -- {primary: "#hex", secondary: "#hex", etc}
  chart_preferences JSONB, -- {defaultTypes: [], sizing: {}, etc}
  default_template_id UUID REFERENCES report_templates(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.report_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chart_configurations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generated_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

-- RLS Policies for report_templates
CREATE POLICY "Users can view all report templates"
ON public.report_templates FOR SELECT USING (true);

CREATE POLICY "Users can create their own report templates"
ON public.report_templates FOR INSERT 
WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Users can update their own report templates"
ON public.report_templates FOR UPDATE 
USING (auth.uid() = created_by);

CREATE POLICY "Users can delete their own report templates"
ON public.report_templates FOR DELETE 
USING (auth.uid() = created_by);

-- RLS Policies for chart_configurations (public read, admin write)
CREATE POLICY "Anyone can view chart configurations"
ON public.chart_configurations FOR SELECT USING (true);

-- RLS Policies for generated_reports
CREATE POLICY "Users can view their own generated reports"
ON public.generated_reports FOR SELECT 
USING (auth.uid() = generated_by);

CREATE POLICY "Users can create their own reports"
ON public.generated_reports FOR INSERT 
WITH CHECK (auth.uid() = generated_by);

-- RLS Policies for user_preferences
CREATE POLICY "Users can view their own preferences"
ON public.user_preferences FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own preferences"
ON public.user_preferences FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own preferences"
ON public.user_preferences FOR UPDATE 
USING (auth.uid() = user_id);

-- Add update triggers
CREATE TRIGGER update_report_templates_updated_at
BEFORE UPDATE ON public.report_templates
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_chart_configurations_updated_at
BEFORE UPDATE ON public.chart_configurations
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_user_preferences_updated_at
BEFORE UPDATE ON public.user_preferences
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Insert default chart configurations
INSERT INTO public.chart_configurations (chart_type, template_name, quickchart_config, default_styling) VALUES
('bar', 'suburb_volume', '{
  "type": "bar",
  "data": {
    "labels": [],
    "datasets": [{
      "label": "Listings",
      "data": [],
      "backgroundColor": ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#84cc16", "#f97316"]
    }]
  },
  "options": {
    "responsive": true,
    "plugins": {
      "title": {"display": true, "text": "Listings by Suburb"},
      "legend": {"display": false}
    },
    "scales": {
      "y": {"beginAtZero": true, "title": {"display": true, "text": "Number of Listings"}}
    }
  }
}', '{"width": 600, "height": 400}'),

('pie', 'property_type', '{
  "type": "pie",
  "data": {
    "labels": [],
    "datasets": [{
      "data": [],
      "backgroundColor": ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"]
    }]
  },
  "options": {
    "responsive": true,
    "plugins": {
      "title": {"display": true, "text": "Property Types"},
      "legend": {"position": "right"}
    }
  }
}', '{"width": 600, "height": 400}'),

('bar', 'price_range', '{
  "type": "bar",
  "data": {
    "labels": [],
    "datasets": [{
      "label": "Listings",
      "data": [],
      "backgroundColor": "#3b82f6"
    }]
  },
  "options": {
    "responsive": true,
    "plugins": {
      "title": {"display": true, "text": "Price Range Distribution"},
      "legend": {"display": false}
    },
    "scales": {
      "y": {"beginAtZero": true, "title": {"display": true, "text": "Number of Listings"}}
    }
  }
}', '{"width": 600, "height": 400}'),

('bar', 'bedroom_count', '{
  "type": "bar",
  "data": {
    "labels": [],
    "datasets": [{
      "label": "Listings",
      "data": [],
      "backgroundColor": "#10b981"
    }]
  },
  "options": {
    "responsive": true,
    "plugins": {
      "title": {"display": true, "text": "Bedrooms Distribution"},
      "legend": {"display": false}
    },
    "scales": {
      "y": {"beginAtZero": true, "title": {"display": true, "text": "Number of Listings"}}
    }
  }
}', '{"width": 600, "height": 400}');

-- Insert default report template
INSERT INTO public.report_templates (name, description, config, is_default) VALUES
('Standard Property Report', 'Default template with all standard charts and KPIs', '{
  "include_kpis": true,
  "include_suburb_chart": true,
  "include_property_type_chart": true,
  "include_price_range_chart": true,
  "include_bedroom_chart": true,
  "chart_configs": {
    "suburb_chart": {"type": "bar", "template": "suburb_volume"},
    "property_type_chart": {"type": "pie", "template": "property_type"},
    "price_range_chart": {"type": "bar", "template": "price_range"},
    "bedroom_chart": {"type": "bar", "template": "bedroom_count"}
  }
}', true);