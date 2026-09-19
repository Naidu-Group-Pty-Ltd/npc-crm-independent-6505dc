-- Wave F7: retire the legacy pdf.js template importer rollout flag.
-- All template PDF imports now route through the Docling Cloud Run pipeline.
DELETE FROM public.feature_flags
WHERE key = 'pdf_import.engine';
