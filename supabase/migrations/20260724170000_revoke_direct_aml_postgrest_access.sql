-- Keep `aml` available to service-role Edge Functions, but never to browser JWTs.
-- AML mutations must use the guarded Edge Function or SECURITY DEFINER RPC paths.
REVOKE USAGE ON SCHEMA aml FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA aml FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA aml FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA aml REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA aml REVOKE ALL ON SEQUENCES FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
