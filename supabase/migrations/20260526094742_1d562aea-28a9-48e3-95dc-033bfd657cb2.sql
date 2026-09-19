
ALTER TABLE public.document_requirement_instances
  ADD COLUMN IF NOT EXISTS quality_status text NOT NULL DEFAULT 'unchecked',
  ADD COLUMN IF NOT EXISTS quality_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS quality_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS detected_doc_type text,
  ADD COLUMN IF NOT EXISTS detected_doc_date date,
  ADD COLUMN IF NOT EXISTS soft_expiry_date date;

CREATE INDEX IF NOT EXISTS idx_dri_soft_expiry ON public.document_requirement_instances(soft_expiry_date) WHERE soft_expiry_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dri_quality_status ON public.document_requirement_instances(quality_status);

CREATE TABLE IF NOT EXISTS public.finance_portal_doc_message_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  finance_user_id uuid REFERENCES public.finance_portal_users(id) ON DELETE CASCADE,
  name text NOT NULL,
  reason text NOT NULL CHECK (reason IN ('stale','illegible','wrong_type','missing_page','chase','custom')),
  body text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fpdmt_user ON public.finance_portal_doc_message_templates(finance_user_id);
CREATE INDEX IF NOT EXISTS idx_fpdmt_reason ON public.finance_portal_doc_message_templates(reason);

ALTER TABLE public.finance_portal_doc_message_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_only_fpdmt" ON public.finance_portal_doc_message_templates;
CREATE POLICY "service_role_only_fpdmt"
  ON public.finance_portal_doc_message_templates
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP TRIGGER IF EXISTS update_fpdmt_updated_at ON public.finance_portal_doc_message_templates;
CREATE TRIGGER update_fpdmt_updated_at
  BEFORE UPDATE ON public.finance_portal_doc_message_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER PUBLICATION supabase_realtime ADD TABLE public.finance_portal_doc_message_templates;

-- Seed workspace-wide templates (finance_user_id NULL = global)
INSERT INTO public.finance_portal_doc_message_templates (finance_user_id, name, reason, body) VALUES
  (NULL, 'Stale document re-request', 'stale',
   'Hi, the {document_type} you uploaded was dated {document_date}, which is now outside the lender''s {max_age_days}-day window. Could you upload a fresh copy when you have a moment? We need the most recent version to keep your finance application moving.'),
  (NULL, 'Illegible upload', 'illegible',
   'Hi, the file you uploaded for {document_type} came through too low-resolution to read clearly. Could you try again — a phone photo in good light or a fresh scan works best. PDF preferred where possible.'),
  (NULL, 'Wrong document type', 'wrong_type',
   'Hi, the file uploaded looks like a {detected_type} but we actually need a {expected_type}. Could you check and upload the correct one? Let me know if you''d like a hand identifying it.'),
  (NULL, 'Missing pages', 'missing_page',
   'Hi, the {document_type} you uploaded looks incomplete — we''re missing page(s) {missing_pages}. Could you upload the full document, including all pages, so we can submit it to the lender?'),
  (NULL, 'Friendly chase', 'chase',
   'Hi — just a quick nudge on the outstanding documents below. Once we have these, we can get your application across the line. Let me know if anything is holding you up.')
ON CONFLICT DO NOTHING;
