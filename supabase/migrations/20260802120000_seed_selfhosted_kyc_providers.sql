-- Seed the zero-cost KYC providers so going live is a toggle, not a data-entry
-- exercise (docs/aml/kyc-go-live-runbook.md).
--
-- Both rows are inserted in SIMULATOR mode. That is not a placeholder — it is
-- the safe state. `getIdvProvider` returns the deterministic simulator whenever
-- mode is 'simulator' regardless of provider_key, so this migration changes no
-- behaviour whatsoever. It exists so that AML › Configuration › Providers shows
-- the two correct provider keys already spelled right, and go-live becomes
-- "switch mode to live" once the service is deployed and the lists are loaded.
--
-- Switching to live BEFORE the service is reachable is safe by design: the
-- adapter throws rather than degrading, so a misconfiguration surfaces as an
-- error to staff instead of a customer who appears to have failed verification.
--
-- Priority is placed AFTER any provider the tenant already has, so an existing
-- configured provider keeps winning resolution. Nothing here can silently take
-- over a tenant that already made a choice.
--
-- Additive and idempotent (UNIQUE (tenant_id, capability, provider_key)).
--
-- ROLLBACK:
--   DELETE FROM aml.provider_configs
--   WHERE provider_key IN ('selfhosted', 'local_lists');

INSERT INTO aml.provider_configs (
  tenant_id, capability, provider_key, display_label, priority,
  cost_per_unit_cents, currency, active, mode, secret_ref, config
)
SELECT
  t.tenant_id,
  'idv',
  'selfhosted',
  'NPC Verification Service (self-hosted)',
  COALESCE((SELECT MAX(p.priority) FROM aml.provider_configs p
            WHERE p.tenant_id = t.tenant_id AND p.capability = 'idv'), 0) + 1,
  0,
  'AUD',
  -- Seeded INACTIVE. This row used to be seeded active in simulator mode so
  -- that go-live was "a toggle"; in production that showed an active identity
  -- provider on the configuration screen while every request refused to
  -- execute it, because production must never run the simulator. See
  -- 20260807000000_no_simulator_idv_in_production.sql.
  false,
  'simulator',
  'AML_VERIFICATION_SERVICE_TOKEN',
  jsonb_build_object(
    'stack', 'zero-cost',
    'models', jsonb_build_array('SFace (Apache-2.0)', 'YuNet (Apache-2.0)'),
    'limitations', jsonb_build_array(
      'no_issuing_authority_check',
      'liveness_is_heuristic_only'
    )
  )
FROM aml.tenant_settings t
ON CONFLICT (tenant_id, capability, provider_key) DO NOTHING;

INSERT INTO aml.provider_configs (
  tenant_id, capability, provider_key, display_label, priority,
  cost_per_unit_cents, currency, active, mode, secret_ref, config
)
SELECT
  t.tenant_id,
  'pep_sanctions',
  'local_lists',
  'Official lists (DFAT / UN / OFAC)',
  COALESCE((SELECT MAX(p.priority) FROM aml.provider_configs p
            WHERE p.tenant_id = t.tenant_id AND p.capability = 'pep_sanctions'), 0) + 1,
  0,
  'AUD',
  true,
  'simulator',
  NULL,
  -- The threshold is recorded here rather than left to a code default because
  -- an AUSTRAC reviewer will ask what it was set to and why. 0.72 is
  -- deliberately low: we have no commercial aggregator's alias and
  -- transliteration corpus, so we buy recall with reviewer time. Every score
  -- above it goes to a human — nothing auto-clears.
  jsonb_build_object(
    'match_threshold', 0.72,
    'threshold_rationale',
      'Tuned for recall over precision. Without a commercial alias/transliteration '
      || 'corpus, under-matching is a compliance failure while over-referring costs '
      || 'reviewer minutes. Every match above this threshold is adjudicated by a person.',
    'lists', jsonb_build_array('dfat', 'un', 'ofac'),
    'adverse_media_covered', false
  )
FROM aml.tenant_settings t
ON CONFLICT (tenant_id, capability, provider_key) DO NOTHING;
