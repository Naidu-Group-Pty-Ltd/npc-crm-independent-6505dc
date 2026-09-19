-- Add chart_images column to generated_reports table to store base64 chart images
ALTER TABLE public.generated_reports 
ADD COLUMN chart_images jsonb;