GRANT SELECT, INSERT, UPDATE, DELETE ON public.feature_flags TO authenticated;
GRANT ALL ON public.feature_flags TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pdf_import_jobs TO authenticated;
GRANT ALL ON public.pdf_import_jobs TO service_role;