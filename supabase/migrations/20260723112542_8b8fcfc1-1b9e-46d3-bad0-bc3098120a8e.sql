
-- Ensure hashing available
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1) Hashed share-token columns
ALTER TABLE public.report_qa_messages
  ADD COLUMN IF NOT EXISTS share_token_hash text,
  ADD COLUMN IF NOT EXISTS share_token_prefix text,
  ADD COLUMN IF NOT EXISTS share_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS share_revoked_at timestamptz,
  ADD COLUMN IF NOT EXISTS share_last_accessed_at timestamptz,
  ADD COLUMN IF NOT EXISTS share_view_count integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_report_qa_messages_share_prefix
  ON public.report_qa_messages(share_token_prefix)
  WHERE share_token_prefix IS NOT NULL;

-- 2) Backfill legacy plaintext share_token → hash (30-day expiry from creation),
--    then null out the plaintext so it can never leak again.
UPDATE public.report_qa_messages
   SET share_token_hash   = encode(digest(share_token::text, 'sha256'), 'hex'),
       share_token_prefix = left(share_token::text, 8),
       share_expires_at   = COALESCE(share_expires_at, created_at + interval '30 days')
 WHERE share_token IS NOT NULL
   AND share_token_hash IS NULL;

UPDATE public.report_qa_messages
   SET share_token = NULL
 WHERE share_token IS NOT NULL
   AND share_token_hash IS NOT NULL;

-- 3) Small server-only access log for public-share rate limiting
CREATE TABLE IF NOT EXISTS public.report_qa_share_access_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  share_token_prefix text NOT NULL,
  message_id uuid,
  outcome text NOT NULL,          -- 'ok' | 'not_found' | 'expired' | 'revoked' | 'rate_limited'
  requester_ip text,
  requester_ua text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.report_qa_share_access_log TO service_role;
ALTER TABLE public.report_qa_share_access_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "share_access_log_service_only"
  ON public.report_qa_share_access_log FOR ALL
  TO service_role USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_report_qa_share_log_prefix_recent
  ON public.report_qa_share_access_log(share_token_prefix, created_at DESC);

-- 4) Replace the public share resolver: hash lookup, expiry/revocation check,
--    minimal projection (no citations, tool traces, or attachments), view count.
DROP FUNCTION IF EXISTS public.get_shared_qa_answer(uuid);
DROP FUNCTION IF EXISTS public.get_shared_qa_answer(text);

CREATE OR REPLACE FUNCTION public.get_shared_qa_answer(_share_token text)
RETURNS TABLE (
  message_id           uuid,
  conversation_id      uuid,
  conversation_title   text,
  role                 text,
  content              text,
  created_at           timestamptz,
  model_provider       text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hash   text;
  v_prefix text;
  v_msg    public.report_qa_messages%ROWTYPE;
BEGIN
  IF _share_token IS NULL OR length(_share_token) < 16 THEN
    RETURN;
  END IF;

  v_hash   := encode(digest(_share_token, 'sha256'), 'hex');
  v_prefix := left(_share_token, 8);

  SELECT * INTO v_msg
    FROM public.report_qa_messages
   WHERE share_token_prefix = v_prefix
     AND share_token_hash   = v_hash
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_msg.share_revoked_at IS NOT NULL THEN
    RETURN;
  END IF;

  IF v_msg.share_expires_at IS NOT NULL AND v_msg.share_expires_at < now() THEN
    RETURN;
  END IF;

  -- Count the view; never log the raw token.
  UPDATE public.report_qa_messages
     SET share_last_accessed_at = now(),
         share_view_count       = share_view_count + 1
   WHERE id = v_msg.id;

  RETURN QUERY
    SELECT v_msg.id,
           v_msg.conversation_id,
           c.title,
           v_msg.role,
           COALESCE(v_msg.edited_content, v_msg.content),
           v_msg.created_at,
           v_msg.model_provider
      FROM public.report_qa_conversations c
     WHERE c.id = v_msg.conversation_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_shared_qa_answer(text) TO anon, authenticated, service_role;
