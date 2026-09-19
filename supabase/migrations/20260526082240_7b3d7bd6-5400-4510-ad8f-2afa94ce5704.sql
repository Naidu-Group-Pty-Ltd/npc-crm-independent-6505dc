
CREATE TABLE IF NOT EXISTS public.purchase_file_condition_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lender_key text,
  title text NOT NULL,
  description text,
  owner text NOT NULL DEFAULT 'client',
  sort_order int NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pfct_lender_key ON public.purchase_file_condition_templates (lender_key) WHERE is_active = true;

ALTER TABLE public.purchase_file_condition_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role manages condition templates" ON public.purchase_file_condition_templates;
CREATE POLICY "service_role manages condition templates"
  ON public.purchase_file_condition_templates
  AS PERMISSIVE FOR ALL TO public
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP TRIGGER IF EXISTS trg_pfct_touch ON public.purchase_file_condition_templates;
CREATE TRIGGER trg_pfct_touch BEFORE UPDATE ON public.purchase_file_condition_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.purchase_file_condition_templates (lender_key, title, description, owner, sort_order) VALUES
  (NULL, 'Satisfactory valuation', 'Lender-acceptable valuation at or above contract price', 'finance_partner', 10),
  (NULL, 'Signed contract of sale', 'Counter-signed copy delivered to lender', 'client', 20),
  (NULL, 'Evidence of deposit funds', 'Statement showing cleared deposit funds', 'client', 30),
  (NULL, 'Insurance — certificate of currency', 'Building insurance noting lender as interested party', 'client', 40),
  (NULL, 'Loan documents executed', 'Borrower-signed loan offer pack', 'client', 50),
  (NULL, 'Conditions cleared with lender', 'All lender-specific conditions discharged', 'finance_partner', 60),
  (NULL, 'Solicitor / conveyancer engaged', 'Settlement representation confirmed', 'legal', 70),
  ('cba', 'CBA NetBank category code confirmed', 'Confirm loan purpose category in NetBank for funding', 'finance_partner', 55),
  ('cba', 'CommBank valuation panel order', 'Valuation ordered via CommBank panel (Valex)', 'finance_partner', 15),
  ('westpac', 'Westpac LMI premium confirmed', 'LMI premium quote attached if LVR > 80%', 'finance_partner', 45),
  ('westpac', 'Westpac category 1 acceptable security', 'Postcode/security confirmed Cat 1 or escalation lodged', 'finance_partner', 25),
  ('anz', 'ANZ Breakfree package election', 'Breakfree vs Simplicity Plus selection signed off', 'finance_partner', 45),
  ('anz', 'ANZ servicing recalculated post-valuation', 'Rerun ANZ HEM/policy after val if LVR shifts', 'finance_partner', 55),
  ('nab', 'NAB Choice package confirmation', 'NAB Choice/Tailored variant confirmed in writing', 'finance_partner', 45),
  ('nab', 'NAB valuation acceptance form', 'Borrower acceptance of NAB-ordered valuation', 'client', 25),
  ('macquarie', 'Macquarie offset hub setup', 'Offset/transaction account opened pre-settlement', 'client', 55),
  ('macquarie', 'Macquarie digital ID verification', 'Client completed Macquarie ID verification flow', 'client', 35),
  ('macquarie', 'Macquarie funds-to-complete evidence', 'Macquarie-stipulated FTC statement uploaded', 'client', 32),
  ('ing', 'ING category 1 location confirmation', 'Security postcode within ING acceptable list', 'finance_partner', 25),
  ('bankwest', 'Bankwest valuation Cat acceptance', 'Bankwest panel val received & category cleared', 'finance_partner', 15),
  ('st george', 'St.George Advantage package election', 'Package/no-package election confirmed', 'finance_partner', 45),
  ('bank of melbourne', 'Bank of Melbourne Advantage election', 'Package election signed off', 'finance_partner', 45),
  ('suncorp', 'Suncorp Home Package Plus election', 'Annual package fee acknowledged in writing', 'finance_partner', 45),
  ('boq', 'BOQ Privileges package election', 'Privileges Package opt-in confirmed', 'finance_partner', 45),
  ('bendigo', 'Bendigo Bank ID & community check', 'Member ID / community link verified', 'client', 35),
  ('pepper', 'Pepper credit narrative finalised', 'Updated credit/serviceability story signed by client', 'finance_partner', 5),
  ('liberty', 'Liberty risk-tier confirmation', 'Final risk tier and pricing confirmed in writing', 'finance_partner', 5),
  ('resimac', 'Resimac alt-doc income evidence', 'BAS / accountant letter / bank stmts compiled', 'client', 35),
  ('la trobe', 'La Trobe specialist scenario sign-off', 'Specialist scenario approval letter on file', 'finance_partner', 5),
  ('firstmac', 'Firstmac digital settlement booking', 'PEXA workspace invitation accepted', 'legal', 65),
  ('ubank', 'ubank digital app + ID completion', 'Client completed in-app ID & employment confirmation', 'client', 35),
  ('amp', 'AMP Professional Pack election', 'Pro Pack opt-in / opt-out confirmed', 'finance_partner', 45),
  ('hsbc', 'HSBC Premier eligibility check', 'Premier relationship status confirmed (if claimed)', 'finance_partner', 35),
  ('athena', 'Athena AutoMatic rate-tier confirmation', 'AutoMatic / tier reduction acknowledged', 'finance_partner', 45)
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.seed_default_conditions_on_conditional_approval()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_lender_norm text;
BEGIN
  IF NEW.finance_status = 'conditional_approval'
     AND (OLD.finance_status IS NULL OR OLD.finance_status <> 'conditional_approval')
     AND NOT EXISTS (
       SELECT 1 FROM public.purchase_file_conditions
       WHERE purchase_file_id = NEW.id AND is_auto_generated = true
     ) THEN

    v_lender_norm := lower(coalesce(NEW.lender, ''));

    INSERT INTO public.purchase_file_conditions
      (purchase_file_id, client_id, title, description, owner, status, is_auto_generated, sort_order)
    SELECT
      NEW.id, NEW.client_id, t.title, t.description, t.owner, 'pending', true, t.sort_order
    FROM public.purchase_file_condition_templates t
    WHERE t.is_active = true
      AND (
        t.lender_key IS NULL
        OR (v_lender_norm <> '' AND v_lender_norm LIKE '%' || t.lender_key || '%')
      );
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_seed_default_conditions ON public.purchase_files;
CREATE TRIGGER trg_seed_default_conditions
  AFTER INSERT OR UPDATE OF finance_status ON public.purchase_files
  FOR EACH ROW EXECUTE FUNCTION public.seed_default_conditions_on_conditional_approval();
