
-- 1. Columns
ALTER TABLE public.client_deals
  ADD COLUMN IF NOT EXISTS purchase_file_id uuid NULL REFERENCES public.purchase_files(id) ON DELETE SET NULL;

ALTER TABLE public.purchase_files
  ADD COLUMN IF NOT EXISTS client_deal_id uuid NULL REFERENCES public.client_deals(id) ON DELETE SET NULL;

-- Unique partial indexes: one-to-one link
CREATE UNIQUE INDEX IF NOT EXISTS uq_client_deals_purchase_file_id
  ON public.client_deals(purchase_file_id) WHERE purchase_file_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_purchase_files_client_deal_id
  ON public.purchase_files(client_deal_id) WHERE client_deal_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_client_deals_purchase_file_id
  ON public.client_deals(purchase_file_id);
CREATE INDEX IF NOT EXISTS idx_purchase_files_client_deal_id
  ON public.purchase_files(client_deal_id);

-- 2. Audit table
CREATE TABLE IF NOT EXISTS public.purchase_file_deal_link_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_file_id uuid NULL,
  client_deal_id uuid NULL,
  client_id uuid NULL,
  action text NOT NULL CHECK (action IN ('linked','unlinked')),
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','auto_backfill','system')),
  actor_user_id uuid NULL,
  note text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pf_deal_audit_pf ON public.purchase_file_deal_link_audit(purchase_file_id);
CREATE INDEX IF NOT EXISTS idx_pf_deal_audit_deal ON public.purchase_file_deal_link_audit(client_deal_id);
CREATE INDEX IF NOT EXISTS idx_pf_deal_audit_client ON public.purchase_file_deal_link_audit(client_id);

ALTER TABLE public.purchase_file_deal_link_audit ENABLE ROW LEVEL SECURITY;

-- Service-role-only RLS standard (project convention)
DROP POLICY IF EXISTS "service role full access pf_deal_link_audit" ON public.purchase_file_deal_link_audit;
CREATE POLICY "service role full access pf_deal_link_audit"
  ON public.purchase_file_deal_link_audit
  AS PERMISSIVE
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 3. Sync triggers (bidirectional)
CREATE OR REPLACE FUNCTION public.sync_purchase_file_deal_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_other_id uuid;
BEGIN
  -- This trigger fires on client_deals.purchase_file_id changes
  IF TG_TABLE_NAME = 'client_deals' THEN
    IF TG_OP = 'UPDATE' AND COALESCE(OLD.purchase_file_id::text,'') = COALESCE(NEW.purchase_file_id::text,'') THEN
      RETURN NEW;
    END IF;

    -- Clear stale reverse pointer
    IF TG_OP = 'UPDATE' AND OLD.purchase_file_id IS NOT NULL AND OLD.purchase_file_id IS DISTINCT FROM NEW.purchase_file_id THEN
      UPDATE public.purchase_files SET client_deal_id = NULL
        WHERE id = OLD.purchase_file_id AND client_deal_id = NEW.id;
    END IF;

    -- Set new reverse pointer
    IF NEW.purchase_file_id IS NOT NULL THEN
      UPDATE public.purchase_files SET client_deal_id = NEW.id
        WHERE id = NEW.purchase_file_id AND (client_deal_id IS DISTINCT FROM NEW.id);
    END IF;
    RETURN NEW;
  END IF;

  -- This trigger fires on purchase_files.client_deal_id changes
  IF TG_TABLE_NAME = 'purchase_files' THEN
    IF TG_OP = 'UPDATE' AND COALESCE(OLD.client_deal_id::text,'') = COALESCE(NEW.client_deal_id::text,'') THEN
      RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE' AND OLD.client_deal_id IS NOT NULL AND OLD.client_deal_id IS DISTINCT FROM NEW.client_deal_id THEN
      UPDATE public.client_deals SET purchase_file_id = NULL
        WHERE id = OLD.client_deal_id AND purchase_file_id = NEW.id;
    END IF;

    IF NEW.client_deal_id IS NOT NULL THEN
      UPDATE public.client_deals SET purchase_file_id = NEW.id
        WHERE id = NEW.client_deal_id AND (purchase_file_id IS DISTINCT FROM NEW.id);
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_client_deals_sync_link ON public.client_deals;
CREATE TRIGGER trg_client_deals_sync_link
AFTER INSERT OR UPDATE OF purchase_file_id ON public.client_deals
FOR EACH ROW EXECUTE FUNCTION public.sync_purchase_file_deal_link();

DROP TRIGGER IF EXISTS trg_purchase_files_sync_link ON public.purchase_files;
CREATE TRIGGER trg_purchase_files_sync_link
AFTER INSERT OR UPDATE OF client_deal_id ON public.purchase_files
FOR EACH ROW EXECUTE FUNCTION public.sync_purchase_file_deal_link();

-- 4. Drift detection view
CREATE OR REPLACE VIEW public.v_purchase_file_deal_drift AS
SELECT
  pf.id AS purchase_file_id,
  cd.id AS client_deal_id,
  pf.client_id,
  pf.property_address AS pf_address,
  cd.property_address AS deal_address,
  pf.purchase_price AS pf_price,
  cd.total_contract_price AS deal_price,
  pf.settlement_date AS pf_settlement_date,
  cd.settlement_date AS deal_settlement_date,
  (LOWER(REGEXP_REPLACE(COALESCE(pf.property_address,''), '\s+', ' ', 'g'))
   IS DISTINCT FROM
   LOWER(REGEXP_REPLACE(COALESCE(cd.property_address,''), '\s+', ' ', 'g'))) AS address_drift,
  (pf.purchase_price IS NOT NULL
    AND cd.total_contract_price IS NOT NULL
    AND ABS(COALESCE(pf.purchase_price,0) - COALESCE(cd.total_contract_price,0)) > 5000) AS price_drift,
  (pf.settlement_date IS NOT NULL
    AND cd.settlement_date IS NOT NULL
    AND pf.settlement_date <> cd.settlement_date) AS settlement_drift
FROM public.purchase_files pf
JOIN public.client_deals cd ON cd.id = pf.client_deal_id
WHERE pf.client_deal_id IS NOT NULL;

-- 5. Notification type extension
DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO v_def
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  WHERE t.relname = 'notifications' AND c.conname = 'notifications_type_check';

  IF v_def IS NOT NULL AND position('purchase_file_linked' in v_def) = 0 THEN
    ALTER TABLE public.notifications DROP CONSTRAINT notifications_type_check;
    -- Rebuild including new values
    EXECUTE 'ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (' ||
      regexp_replace(v_def, '^CHECK \((.*)\)$', '\1') ||
      ' OR type IN (''purchase_file_linked'',''purchase_file_unlinked''))';
  END IF;
EXCEPTION WHEN OTHERS THEN
  -- if notifications table or constraint doesn't exist in this shape, skip silently
  NULL;
END $$;

-- 6. Realtime publication
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.purchase_file_deal_link_audit;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;
