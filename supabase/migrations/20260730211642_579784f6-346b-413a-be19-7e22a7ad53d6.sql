CREATE OR REPLACE FUNCTION public.consume_solicitor_portal_reset_attempt(
  p_email text, p_max integer
) RETURNS TABLE(status text, reset_token text, user_id uuid, firm_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
  v_firm_id uuid;
  v_token text;
  v_expires_at timestamptz;
  v_attempts integer;
BEGIN
  UPDATE solicitor_portal_users
     SET reset_attempts = COALESCE(reset_attempts, 0) + 1
   WHERE id = (
     SELECT id
       FROM solicitor_portal_users
      WHERE email = lower(trim(p_email))
        AND reset_token IS NOT NULL
        AND is_active
        AND revoked_at IS NULL
      LIMIT 1
   )
  RETURNING id, solicitor_portal_users.firm_id, solicitor_portal_users.reset_token,
            reset_token_expires_at, reset_attempts
       INTO v_id, v_firm_id, v_token, v_expires_at, v_attempts;

  IF v_id IS NULL THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::text, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  IF v_attempts > p_max THEN
    UPDATE solicitor_portal_users
       SET reset_token = NULL, reset_token_expires_at = NULL
     WHERE id = v_id;
    RETURN QUERY SELECT 'too_many'::text, NULL::text, v_id, v_firm_id;
    RETURN;
  END IF;

  IF v_expires_at IS NULL OR v_expires_at < now() THEN
    RETURN QUERY SELECT 'expired'::text, NULL::text, v_id, v_firm_id;
    RETURN;
  END IF;

  RETURN QUERY SELECT 'ok'::text, v_token, v_id, v_firm_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.consume_solicitor_portal_reset_attempt(text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_solicitor_portal_reset_attempt(text, integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.sync_legal_matter_purchase_file_link()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  previous_purchase_file_id uuid;
  previous_legal_matter_id uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF TG_TABLE_NAME = 'legal_matters' THEN
      previous_purchase_file_id := OLD.purchase_file_id;
    ELSIF TG_TABLE_NAME = 'purchase_files' THEN
      previous_legal_matter_id := OLD.legal_matter_id;
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'legal_matters' THEN
    IF NEW.purchase_file_id IS DISTINCT FROM previous_purchase_file_id THEN
      IF previous_purchase_file_id IS NOT NULL THEN
        UPDATE public.purchase_files SET legal_matter_id = NULL
          WHERE id = previous_purchase_file_id AND legal_matter_id = NEW.id;
      END IF;
      IF NEW.purchase_file_id IS NOT NULL THEN
        UPDATE public.purchase_files SET legal_matter_id = NEW.id
          WHERE id = NEW.purchase_file_id AND legal_matter_id IS DISTINCT FROM NEW.id;
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'purchase_files' THEN
    IF NEW.legal_matter_id IS DISTINCT FROM previous_legal_matter_id THEN
      IF previous_legal_matter_id IS NOT NULL THEN
        UPDATE public.legal_matters SET purchase_file_id = NULL
          WHERE id = previous_legal_matter_id AND purchase_file_id = NEW.id;
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