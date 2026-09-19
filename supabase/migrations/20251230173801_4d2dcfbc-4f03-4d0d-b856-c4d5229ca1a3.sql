-- Add new template type for Q&A Export PDF templates
ALTER TYPE template_type ADD VALUE IF NOT EXISTS 'qa_export';

-- Add comment explaining the new type
COMMENT ON TYPE template_type IS 'Types of report templates: ai_structure (for AI RAG), pdf_layout (for PDF generation), client_branding (for white-label), qa_export (for Report Q&A PDF export)';