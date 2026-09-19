# AML V3 · Phase 11 — Dedicated Integration Health Workspace (Directive 13, long-term)

## Scope
Phase 11 closes the long-term half of **Directive 13**: provider
telemetry (calls / failure rate / latency / cost) now has its own
workspace at `/admin/aml-integration-health`, entirely out of the
daily AML workflow. Phase 7 already hid the tiles from Configuration
when `aml_v3_metrics_relocation` is on — this phase supplies the
destination the relocation UI copy already promises.

No end-user AML workflow changes. No case, alert, or report surface
is touched.

## Directive coverage
- **13. Relocate provider metrics away from daily workflow** —
  completed. Cutover Console copy in Phase 10 and the Configuration
  banner in Phase 7 already reference this workspace; Phase 11
  provides it.

## Files touched
- `src/pages/admin/AmlIntegrationHealth.tsx` — new read-only telemetry
  workspace. Uses the existing `amlTenantApi.metricsRollup` and
  `amlTenantApi.listProviders` (no new edge function).
- `src/App.tsx` — mounts route `/admin/aml-integration-health`.

## Surface
- KPI row: total calls, failure rate (tone-graded), calls-weighted
  avg latency, total cost over the selected window.
- Provider health summary (ok / degraded / failing / unknown).
- Per-provider rollup table sorted by call volume, with health,
  mode and active flags.
- Daily call-volume bars with failures overlaid in destructive tone.
- Time window selector: 7 / 14 / 30 / 60 / 90 days.
- Capability filter: all IDV / PEP & sanctions / adverse media /
  transaction monitoring / AUSTRAC lodgement.

## Guardrails preserved
- **Read-only.** No writes. Provider configuration remains behind
  Organisation Settings → Providers (Directive 12 hard-exclusion
  untouched).
- **Launch Ops (Directive 9)** untouched.
- **Access gate.** Superadmin OR MLRO can view. Non-MLRO superadmins
  see a read-only banner.
- **No schema change, no new edge function, no data migration.**
- **Tri-portal separation.** Command Centre-only surface; nothing
  reaches Client Portal or Finance Portal.

## Cutover interaction
- When `aml_v3_metrics_relocation` is OFF the page still works but
  shows an amber note reminding operators to flip the flag in the
  Cutover Console to complete the relocation.
- When ON the tiles are already hidden in Configuration, so operators
  navigate here for provider telemetry.

## Phase 11 acceptance
- [x] New workspace live at `/admin/aml-integration-health`.
- [x] Read-only; uses existing `provider_metrics_rollup` op.
- [x] Superadmin/MLRO gate; non-privileged users blocked.
- [x] Hard exclusions preserved (Launch Ops, Provider Configuration).
- [x] No schema or edge-function changes.
- [x] Tri-portal separation intact.
