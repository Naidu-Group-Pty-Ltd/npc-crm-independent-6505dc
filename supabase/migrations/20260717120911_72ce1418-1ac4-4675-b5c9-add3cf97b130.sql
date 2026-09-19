ALTER TABLE aml.provider_configs
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'simulator'
    CHECK (mode IN ('simulator','live'));

CREATE INDEX IF NOT EXISTS idx_provider_configs_mode ON aml.provider_configs(mode);