-- Keep market Q&A history private to its creator and prevent callers from
-- writing retrieval anchors directly. The edge function writes these rows with
-- the service role after authenticating the caller and stamps created_by.

REVOKE INSERT ON public.market_update_questions FROM authenticated;

DROP POLICY IF EXISTS "Authenticated users can insert own market questions"
  ON public.market_update_questions;
DROP POLICY IF EXISTS "Authenticated users can read market questions"
  ON public.market_update_questions;

CREATE POLICY "Authenticated users can read own market questions"
  ON public.market_update_questions
  FOR SELECT
  TO authenticated
  USING (created_by = auth.uid());

DROP INDEX IF EXISTS public.market_update_questions_conv_idx;
CREATE INDEX market_update_questions_owner_conv_idx
  ON public.market_update_questions (created_by, conversation_id, created_at DESC)
  WHERE conversation_id IS NOT NULL;
