-- Phase 6: Notifications + auto-backfill for purchase_file ↔ client_deal links

-- 1. Notification trigger for link/unlink audit events → notify deal/purchase_file owners
CREATE OR REPLACE FUNCTION public.notify_purchase_file_deal_link()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_name text;
  v_pf_address text;
  v_deal_address text;
  v_recipients uuid[];
BEGIN
  SELECT COALESCE(c.first_name || ' ' || c.last_name, 'Client')
    INTO v_client_name
  FROM clients c WHERE c.id = NEW.client_id;

  SELECT property_address INTO v_pf_address FROM purchase_files WHERE id = NEW.purchase_file_id;
  SELECT property_address INTO v_deal_address FROM client_deals  WHERE id = NEW.client_deal_id;

  -- Notify the actor and any assigned advisor/broker on the client
  SELECT ARRAY(
    SELECT DISTINCT u FROM unnest(ARRAY[
      NEW.actor_user_id,
      (SELECT assigned_advisor_id FROM clients WHERE id = NEW.client_id),
      (SELECT assigned_broker_id  FROM clients WHERE id = NEW.client_id)
    ]) AS u
    WHERE u IS NOT NULL
  ) INTO v_recipients;

  IF v_recipients IS NOT NULL THEN
    INSERT INTO notifications (user_id, type, title, message, link, metadata)
    SELECT
      r,
      CASE WHEN NEW.action = 'linked' THEN 'purchase_file_linked' ELSE 'purchase_file_unlinked' END,
      CASE WHEN NEW.action = 'linked'
           THEN 'Finance file linked to deal'
           ELSE 'Finance file unlinked from deal' END,
      v_client_name || ' — ' || COALESCE(v_pf_address, v_deal_address, 'property'),
      '/finance-portal/purchase-files/' || NEW.purchase_file_id,
      jsonb_build_object(
        'purchase_file_id', NEW.purchase_file_id,
        'client_deal_id',   NEW.client_deal_id,
        'client_id',        NEW.client_id,
        'source',           NEW.source
      )
    FROM unnest(v_recipients) AS r;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_purchase_file_deal_link ON purchase_file_deal_link_audit;
CREATE TRIGGER trg_notify_purchase_file_deal_link
  AFTER INSERT ON purchase_file_deal_link_audit
  FOR EACH ROW EXECUTE FUNCTION public.notify_purchase_file_deal_link();

-- 2. One-off auto-backfill: link where same client, normalized address matches,
--    AND exactly one candidate on each side, AND neither side is already linked.
DO $$
DECLARE
  r record;
  v_norm_pf text;
  v_norm_deal text;
  v_count int;
BEGIN
  FOR r IN
    SELECT pf.id AS pf_id, pf.client_id, pf.property_address AS pf_addr,
           cd.id AS deal_id, cd.property_address AS deal_addr
    FROM purchase_files pf
    JOIN client_deals cd
      ON cd.client_id = pf.client_id
     AND cd.purchase_file_id IS NULL
    WHERE pf.client_deal_id IS NULL
      AND pf.property_address IS NOT NULL
      AND cd.property_address IS NOT NULL
      AND lower(regexp_replace(pf.property_address, '[^a-z0-9]', '', 'gi'))
        = lower(regexp_replace(cd.property_address, '[^a-z0-9]', '', 'gi'))
  LOOP
    -- ensure single candidate on each side
    SELECT count(*) INTO v_count
    FROM client_deals cd2
    WHERE cd2.client_id = r.client_id
      AND cd2.purchase_file_id IS NULL
      AND cd2.property_address IS NOT NULL
      AND lower(regexp_replace(cd2.property_address, '[^a-z0-9]', '', 'gi'))
        = lower(regexp_replace(r.pf_addr, '[^a-z0-9]', '', 'gi'));
    IF v_count <> 1 THEN CONTINUE; END IF;

    SELECT count(*) INTO v_count
    FROM purchase_files pf2
    WHERE pf2.client_id = r.client_id
      AND pf2.client_deal_id IS NULL
      AND pf2.property_address IS NOT NULL
      AND lower(regexp_replace(pf2.property_address, '[^a-z0-9]', '', 'gi'))
        = lower(regexp_replace(r.deal_addr, '[^a-z0-9]', '', 'gi'));
    IF v_count <> 1 THEN CONTINUE; END IF;

    -- Set link (trigger keeps reverse side in sync)
    UPDATE purchase_files
       SET client_deal_id = r.deal_id
     WHERE id = r.pf_id
       AND client_deal_id IS NULL;

    INSERT INTO purchase_file_deal_link_audit
      (purchase_file_id, client_deal_id, client_id, action, source, note)
    VALUES
      (r.pf_id, r.deal_id, r.client_id, 'linked', 'auto_backfill',
       'Auto-linked: single address match on client');
  END LOOP;
END $$;
