CREATE OR REPLACE FUNCTION public.bump_pf_last_partner_action()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.actor_kind IS NULL OR NEW.actor_kind IN ('finance_partner', 'finance_user', 'partner') THEN
    UPDATE public.purchase_files
       SET last_partner_action_at = now()
     WHERE id = NEW.purchase_file_id;
  END IF;
  RETURN NEW;
END;
$$;