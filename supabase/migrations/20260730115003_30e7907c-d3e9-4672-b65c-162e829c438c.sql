-- ─────────────── ENUMS ───────────────
DO $$ BEGIN
  CREATE TYPE public.legal_matter_type AS ENUM (
    'purchase','sale','transfer','off_the_plan','house_and_land','refinance','commercial','other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.legal_matter_status AS ENUM (
    'instructed','contract_review','exchanged','cooling_off','conditions','unconditional',
    'pre_settlement','settled','post_settlement','terminated','on_hold'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.legal_party_role AS ENUM (
    'buyer','seller','buyer_solicitor','seller_solicitor','agent','lender','broker',
    'builder','guarantor','trustee','accountant','other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─────────────── LEGAL MATTERS ───────────────
CREATE TABLE IF NOT EXISTS public.legal_matters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_reference text,
  title text NOT NULL,
  matter_type public.legal_matter_type NOT NULL DEFAULT 'purchase',
  status public.legal_matter_status NOT NULL DEFAULT 'instructed',

  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  firm_id uuid REFERENCES public.solicitor_firms(id) ON DELETE SET NULL,
  assigned_solicitor_user_id uuid REFERENCES public.solicitor_portal_users(id) ON DELETE SET NULL,

  purchase_file_id uuid REFERENCES public.purchase_files(id) ON DELETE SET NULL,
  client_deal_id uuid REFERENCES public.client_deals(id) ON DELETE SET NULL,
  build_job_id uuid,

  property_address text,
  property_suburb text,
  property_state text,
  property_postcode text,
  title_reference text,
  lot_plan text,

  purchase_price numeric,
  deposit_amount numeric,
  deposit_percent numeric,

  contract_date date,
  exchange_date date,
  cooling_off_expiry date,
  finance_clause_date date,
  building_pest_date date,
  sunset_date date,
  settlement_date date,
  actual_settlement_date date,

  pexa_workspace_id text,
  other_side_firm text,
  risk_flag boolean NOT NULL DEFAULT false,
  risk_notes text,

  internal_notes text,
  shared_summary text,

  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_legal_matters_client ON public.legal_matters(client_id);
CREATE INDEX IF NOT EXISTS idx_legal_matters_firm ON public.legal_matters(firm_id);
CREATE INDEX IF NOT EXISTS idx_legal_matters_assignee ON public.legal_matters(assigned_solicitor_user_id);
CREATE INDEX IF NOT EXISTS idx_legal_matters_status ON public.legal_matters(status);
CREATE INDEX IF NOT EXISTS idx_legal_matters_settlement ON public.legal_matters(settlement_date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_legal_matters_pf_unique ON public.legal_matters(purchase_file_id) WHERE purchase_file_id IS NOT NULL;

GRANT ALL ON public.legal_matters TO service_role;
ALTER TABLE public.legal_matters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "legal_matters_service_role_only" ON public.legal_matters
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─────────────── MATTER PARTIES ───────────────
CREATE TABLE IF NOT EXISTS public.legal_matter_parties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_matter_id uuid NOT NULL REFERENCES public.legal_matters(id) ON DELETE CASCADE,
  role public.legal_party_role NOT NULL DEFAULT 'other',
  name text NOT NULL,
  organisation text,
  email text,
  phone text,
  address text,
  reference text,
  is_primary_contact boolean NOT NULL DEFAULT false,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_legal_matter_parties_matter ON public.legal_matter_parties(legal_matter_id);

GRANT ALL ON public.legal_matter_parties TO service_role;
ALTER TABLE public.legal_matter_parties ENABLE ROW LEVEL SECURITY;
CREATE POLICY "legal_matter_parties_service_role_only" ON public.legal_matter_parties
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─────────────── STATUS HISTORY ───────────────
CREATE TABLE IF NOT EXISTS public.legal_matter_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_matter_id uuid NOT NULL REFERENCES public.legal_matters(id) ON DELETE CASCADE,
  from_status public.legal_matter_status,
  to_status public.legal_matter_status NOT NULL,
  changed_by_type text NOT NULL DEFAULT 'solicitor_user',
  changed_by_solicitor_user_id uuid REFERENCES public.solicitor_portal_users(id) ON DELETE SET NULL,
  changed_by_user_id uuid,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_legal_matter_status_history_matter
  ON public.legal_matter_status_history(legal_matter_id, created_at DESC);

GRANT ALL ON public.legal_matter_status_history TO service_role;
ALTER TABLE public.legal_matter_status_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "legal_matter_status_history_service_role_only" ON public.legal_matter_status_history
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─────────────── BIDIRECTIONAL PF LINK ───────────────
ALTER TABLE public.purchase_files
  ADD COLUMN IF NOT EXISTS legal_matter_id uuid REFERENCES public.legal_matters(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_purchase_files_legal_matter ON public.purchase_files(legal_matter_id);

CREATE OR REPLACE FUNCTION public.sync_legal_matter_purchase_file_link()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_TABLE_NAME = 'legal_matters' THEN
    IF NEW.purchase_file_id IS DISTINCT FROM COALESCE(OLD.purchase_file_id, NULL) THEN
      IF OLD IS NOT NULL AND OLD.purchase_file_id IS NOT NULL THEN
        UPDATE public.purchase_files SET legal_matter_id = NULL
          WHERE id = OLD.purchase_file_id AND legal_matter_id = NEW.id;
      END IF;
      IF NEW.purchase_file_id IS NOT NULL THEN
        UPDATE public.purchase_files SET legal_matter_id = NEW.id
          WHERE id = NEW.purchase_file_id AND legal_matter_id IS DISTINCT FROM NEW.id;
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'purchase_files' THEN
    IF NEW.legal_matter_id IS DISTINCT FROM COALESCE(OLD.legal_matter_id, NULL) THEN
      IF OLD IS NOT NULL AND OLD.legal_matter_id IS NOT NULL THEN
        UPDATE public.legal_matters SET purchase_file_id = NULL
          WHERE id = OLD.legal_matter_id AND purchase_file_id = NEW.id;
      END IF;
      IF NEW.legal_matter_id IS NOT NULL THEN
        UPDATE public.legal_matters SET purchase_file_id = NEW.id
          WHERE id = NEW.legal_matter_id AND purchase_file_id IS DISTINCT FROM NEW.id;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_legal_matters_link_sync ON public.legal_matters;
CREATE TRIGGER trg_legal_matters_link_sync
  AFTER INSERT OR UPDATE OF purchase_file_id ON public.legal_matters
  FOR EACH ROW EXECUTE FUNCTION public.sync_legal_matter_purchase_file_link();

DROP TRIGGER IF EXISTS trg_purchase_files_legal_link_sync ON public.purchase_files;
CREATE TRIGGER trg_purchase_files_legal_link_sync
  AFTER INSERT OR UPDATE OF legal_matter_id ON public.purchase_files
  FOR EACH ROW EXECUTE FUNCTION public.sync_legal_matter_purchase_file_link();

-- ─────────────── STATUS HISTORY TRIGGER ───────────────
CREATE OR REPLACE FUNCTION public.log_legal_matter_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.legal_matter_status_history (legal_matter_id, from_status, to_status, changed_by_type, reason)
    VALUES (NEW.id, NULL, NEW.status, 'system', 'Matter opened');
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.legal_matter_status_history (legal_matter_id, from_status, to_status, changed_by_type)
    VALUES (NEW.id, OLD.status, NEW.status, 'system');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_legal_matters_status_history ON public.legal_matters;
CREATE TRIGGER trg_legal_matters_status_history
  AFTER INSERT OR UPDATE OF status ON public.legal_matters
  FOR EACH ROW EXECUTE FUNCTION public.log_legal_matter_status_change();

-- ─────────────── UPDATED_AT ───────────────
DROP TRIGGER IF EXISTS trg_legal_matters_updated_at ON public.legal_matters;
CREATE TRIGGER trg_legal_matters_updated_at
  BEFORE UPDATE ON public.legal_matters
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_legal_matter_parties_updated_at ON public.legal_matter_parties;
CREATE TRIGGER trg_legal_matter_parties_updated_at
  BEFORE UPDATE ON public.legal_matter_parties
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ─────────────── ASSIGNMENT FK ───────────────
DO $$ BEGIN
  ALTER TABLE public.solicitor_portal_client_assignments
    ADD CONSTRAINT solicitor_assignments_matter_fk
    FOREIGN KEY (legal_matter_id) REFERENCES public.legal_matters(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─────────────── REALTIME ───────────────
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.legal_matters;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.legal_matter_parties;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.legal_matter_status_history;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;