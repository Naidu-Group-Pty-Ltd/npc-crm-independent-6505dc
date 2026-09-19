ALTER TABLE aml.provider_configs
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'simulator'
  CHECK (mode IN ('simulator','live'));
COMMENT ON COLUMN aml.provider_configs.mode IS
  'Phase 6 provider orchestration: simulator (deterministic, no external calls) vs live (real provider, requires configured secrets).';