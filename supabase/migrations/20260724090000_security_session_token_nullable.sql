-- =============================================================================
-- WP-11A: allow hash-only staff sessions (drop NOT NULL on session_token)
-- =============================================================================
--
-- Sessions are now stored as a peppered HMAC `token_hash`; the plaintext
-- `session_token` is written only as a fallback when the pepper is unconfigured.
-- The column was NOT NULL, which would reject a hash-only insert, so relax it.
--
-- Non-destructive and backward-compatible: existing rows keep their value and
-- code paths that still write session_token continue to work. Readers already
-- resolve sessions hash-first with a plaintext fallback.
--
-- The physical column is dropped in a LATER migration, only after (a) this ships,
-- (b) every legacy plaintext-only session has expired (soak), and (c) the
-- plaintext-fallback read paths are removed from the shared session helpers.
-- =============================================================================

ALTER TABLE public.user_sessions ALTER COLUMN session_token DROP NOT NULL;
