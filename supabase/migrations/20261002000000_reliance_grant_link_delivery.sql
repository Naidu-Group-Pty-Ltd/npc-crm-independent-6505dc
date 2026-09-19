-- Passport delivery by link: where a grant's link was sent, and when a
-- partner asked for a new one.
--
-- The access token is shown ONCE and stored only as a hash, so a link can
-- never be re-read from the database — re-issuing means minting a new grant
-- and revoking the old one. These columns record what happened around that:
-- the address the link was delivered to (so a re-issue can offer the same
-- one), and the partner's own request for a replacement after the 90 days
-- lapse.
--
-- All columns are nullable or defaulted, so every existing row and every
-- existing insert keeps working untouched; `grant_access` writes them after
-- the grant exists rather than as part of the insert.

ALTER TABLE aml.reliance_grants
  ADD COLUMN IF NOT EXISTS delivered_to_email text,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  -- A partner presenting an EXPIRED link may ask for a replacement. They
  -- mint nothing: this is a counter and a timestamp, and the request lands
  -- in the Command Centre for a person to act on. A REVOKED link never
  -- offers this — revocation is a safety action and must not be self-undone.
  ADD COLUMN IF NOT EXISTS link_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS link_request_count integer NOT NULL DEFAULT 0,
  -- Set on the OLD grant when a re-issue replaces it, so the register shows
  -- the chain rather than a revocation with no successor.
  ADD COLUMN IF NOT EXISTS reissued_by_grant_id uuid REFERENCES aml.reliance_grants(id) ON DELETE SET NULL;

COMMENT ON COLUMN aml.reliance_grants.delivered_to_email IS
  'The address the one-time passport link was emailed to. The link itself is never stored — only its hash.';
COMMENT ON COLUMN aml.reliance_grants.link_request_count IS
  'How many times the partner asked for a replacement link from an expired one. Requesting mints nothing.';
