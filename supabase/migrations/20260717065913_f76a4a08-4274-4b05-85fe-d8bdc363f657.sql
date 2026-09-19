-- Expose the `aml` schema through PostgREST so edge functions using
-- supabase.schema('aml').from(...) stop failing with PGRST106.
ALTER ROLE authenticator SET pgrst.db_schemas = 'public, graphql_public, aml';
GRANT USAGE ON SCHEMA aml TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA aml TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA aml TO service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA aml TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA aml GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA aml GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA aml GRANT ALL ON FUNCTIONS TO service_role;
NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';