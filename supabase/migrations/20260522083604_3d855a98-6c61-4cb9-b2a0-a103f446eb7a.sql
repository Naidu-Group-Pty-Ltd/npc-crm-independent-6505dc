CREATE OR REPLACE FUNCTION public.list_truncated_email_ids(_limit int DEFAULT 50)
RETURNS TABLE(id uuid, sender text, subject text, received_at timestamptz, body text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, sender, subject, received_at, body
  FROM public.email_copilot_emails
  WHERE body_html IS NULL
    AND length(body) >= 10000
  ORDER BY received_at DESC
  LIMIT _limit;
$$;

REVOKE ALL ON FUNCTION public.list_truncated_email_ids(int) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_truncated_email_ids(int) TO service_role;