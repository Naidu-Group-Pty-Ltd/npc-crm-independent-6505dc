-- Prevent INSERT trigger executions from dereferencing the unavailable OLD row.
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
  -- OLD is not assigned for INSERT triggers. Copy its relevant value only in
  -- the UPDATE branch, then use the safe local variables below.
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
