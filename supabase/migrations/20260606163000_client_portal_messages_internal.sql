-- #16 Cross-portal messaging: the Command Center composer can now mark a message
-- as Internal (staff-only), or send it to the Client portal or the Finance
-- partner. Internal messages live in client_portal_messages but must never be
-- exposed to the client, so add an is_internal flag and index it.
ALTER TABLE public.client_portal_messages
  ADD COLUMN IF NOT EXISTS is_internal boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_client_portal_messages_internal
  ON public.client_portal_messages(client_id, is_internal);
