# AML V3 — Phase 7 Brief

**Directives:** 11 (structured terminology label editor) + 13 (relocate
provider metrics away from the daily workflow).
**Feature flags:** `aml_v3_terminology_editor`, `aml_v3_metrics_relocation`
(both reserved default `false`).
**Scope:** UI-only additive change to `src/pages/aml/AmlConfiguration.tsx`.
No schema changes to `aml.tenant_settings` or provider tables. No
mutations to Provider Configuration (Directive 12) or Launch Operations
(Directive 9).

## What shipped

### Directive 11 — Structured terminology editor
- New component `StructuredTerminologyEditor` inside
  `AmlConfiguration.tsx`.
- Renders a row-based editor (original label + your replacement + remove)
  with an "Add override" action.
- Persists as the same JSON string the backend already accepts, so
  `amlTenantApi.updateSettings` and the existing rejected-key handling
  work unchanged.
- Locked regulatory terms remain refused server-side; UI highlights any
  locked key typed into a row and disables the replacement input.
- Falls back to the raw JSON textarea (V2 behaviour) when the flag is
  off or when existing overrides are not valid JSON.

### Directive 13 — Metrics relocation
- When `aml_v3_metrics_relocation` is on, the two provider-metrics tiles
  (30-day calls, 30-day cost) are removed from the daily configuration
  header; the header copy is updated to point users to the Integration
  Health workspace.
- The full **Metrics tab** inside `AmlConfiguration` is retained
  untouched — nothing is deleted, only surfaced elsewhere. The dedicated
  tab remains available for MLRO-only deep-dives.

### Feature flags
- `useAmlV3Flags` extended with `terminologyEditor` and
  `metricsRelocation` booleans.
- Migration inserts both flags into `public.feature_flags` with `false`
  defaults.

## Guardrails honoured
- Provider Configuration panel byte-identical (Directive 12).
- `AmlLaunchOps` untouched (Directive 9).
- No schema changes; no new tables; no new writes.
- Superadmin bypass and step-up rules unchanged.
- Tri-portal separation preserved — no metrics or terminology leaks into
  Client Portal / Finance Portal.

## Verification
- Build passes with no new TS errors.
- Default runtime unchanged (flags off): configuration screen is
  byte-identical to Phase 6.
- Flipping `aml_v3_terminology_editor` swaps the JSON textarea for the
  structured row editor and still persists correctly via the existing
  save path.
- Flipping `aml_v3_metrics_relocation` hides the two metrics tiles and
  updates the header copy without removing the Metrics tab.

## Not in scope
- Building the standalone Integration Health workspace (Phase 8+).
- Server-side normalisation of terminology keys (still handled today).
- Any change to `provider_metrics_daily` or provider webhooks.
