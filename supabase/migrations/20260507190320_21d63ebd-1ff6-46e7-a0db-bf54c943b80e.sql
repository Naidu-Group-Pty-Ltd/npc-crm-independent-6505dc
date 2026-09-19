ALTER TABLE public.ghl_marketing_raw_dumps DROP CONSTRAINT IF EXISTS ghl_marketing_raw_dumps_resource_type_check;
ALTER TABLE public.ghl_marketing_raw_dumps ADD CONSTRAINT ghl_marketing_raw_dumps_resource_type_check
  CHECK (resource_type = ANY (ARRAY['form'::text, 'survey'::text, 'quiz'::text, 'funnel'::text, 'funnel_page'::text, 'workflow'::text, 'location_custom_schema'::text]));