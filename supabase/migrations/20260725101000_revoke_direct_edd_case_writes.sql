-- EDD records are accessed by authenticated users only through the AML edge/RPC
-- control plane. In particular, direct table writes must not bypass the MLRO-only
-- decision operation.
REVOKE ALL PRIVILEGES ON TABLE aml.edd_cases FROM authenticated;

-- Keep the trusted backend adapter operational.
GRANT ALL PRIVILEGES ON TABLE aml.edd_cases TO service_role;
