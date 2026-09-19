-- Share slugs are bearer credentials and must not be enumerable through PostgREST.
-- Public resolution is mediated by the market-qa-share edge function, which uses
-- the service role and validates the requested slug, revocation, and expiry.
REVOKE SELECT ON public.market_update_qa_shares FROM anon;

DROP POLICY IF EXISTS "Anyone can view non-revoked share by slug"
  ON public.market_update_qa_shares;

-- Preserve the authenticated owner's list-mine flow without exposing other
-- users' share records. The service role continues to bypass RLS for resolution.
CREATE POLICY "Owners can view own shares"
  ON public.market_update_qa_shares FOR SELECT
  TO authenticated
  USING (auth.uid() = created_by);
