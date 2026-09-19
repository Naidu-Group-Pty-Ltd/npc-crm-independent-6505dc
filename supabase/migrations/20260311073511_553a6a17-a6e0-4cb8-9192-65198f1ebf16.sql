-- First unset any existing defaults
UPDATE public.gamma_agreement_templates SET is_default = false WHERE is_default = true;

-- Insert the original Gamma template as the default
INSERT INTO public.gamma_agreement_templates (name, gamma_template_id, description, is_default, is_active, placeholder_mappings)
VALUES (
  'Buyer''s Agent Agreement (Original)',
  'g_qpgo1oc9t6djtud',
  'Original Buyer''s Agent Agreement template',
  true,
  true,
  '[{"placeholder": "[Buyer''s Name]", "field": "buyer_names"}, {"placeholder": "[Address]", "field": "buyer_address"}, {"placeholder": "[Phone Number]", "field": "buyer_phone"}, {"placeholder": "[Email]", "field": "buyer_email"}, {"placeholder": "[Initial Commitment Fee]", "field": "initial_commitment_fee", "defaultValue": "$1,500.00 + GST"}, {"placeholder": "[Date]", "field": "agreement_date"}]'::jsonb
)
ON CONFLICT DO NOTHING;