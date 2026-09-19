# AML V3 · Phase 10 — Cutover Console & Acceptance Gate

## Scope
Phase 10 closes the sole outstanding follow-up from Phase 8: the superadmin
per-tenant flag console. All eight `aml_v3_*` flags reserved across Phases
0–9 can now be toggled from `/admin/aml-v3-cutover` in the recommended
sequence, with no direct `public.feature_flags` edits required.

**No AML end-user surface changes in this phase.** Every flag remains
default-off. Rolling back a flag returns the surface to V2 with no data
migration.

## Directive coverage
Phase 10 does not deliver a new directive — it is the operational
control-plane for Directives 1–15 already implemented in Phases 1–9.

## Files touched
- `src/pages/admin/AmlV3Cutover.tsx` — new superadmin console. Reads and
  upserts the eight V3 flags via `feature-flags-admin`, ordered by the
  recommended flip sequence from `phase-8-brief.md §6`.
- `src/App.tsx` — mounts route `/admin/aml-v3-cutover` (superadmin gate
  enforced client-side in the page and server-side in
  `feature-flags-admin`).

## Guardrails preserved
- **Hard exclusions untouched.** The console only edits `aml_v3_*` flags.
  `AmlLaunchOps.tsx`, `aml-launch-ops`, `aml-provider-webhook`, and the
  Provider Configuration sub-panel are neither read nor written.
- **Superadmin gate.** Client-side `useAuth().isSuperadmin` guard plus
  server-side re-check inside `feature-flags-admin`.
- **Cache coherence.** After every successful upsert the console calls
  `refreshAmlV3Flags()` so any open AML tab picks up the change on next
  render — no stale session cache.
- **Legacy routes preserved.** No routing table changes for `/admin/aml/*`.
- **Tri-portal separation.** Console is Command Centre-only; nothing is
  exposed to Client Portal or Finance Portal.
- **No schema change, no new edge function, no data migration.**

## Recommended flip order (surfaced in UI)
1. `aml_v3_terminology_editor` + `aml_v3_metrics_relocation` (safest — config).
2. `aml_v3_start_client_compliance`.
3. `aml_v3_compliance_home`.
4. `aml_v3_regulatory_hub`.
5. `aml_v3_case_workspace` + `aml_v3_org_settings`.
6. `aml_v3_nav` (LAST — activates the four-workspace shell).

## Acceptance checklist (rendered on the page)
- Legacy `/admin/aml/*` routes still resolve.
- Launch Ops and Provider Configuration surfaces unchanged.
- Client Portal / Finance Portal show no restricted case fields.
- Step-up sessions still enforced for `aml.report` and `aml.configure`.
- Superadmin bypass preserved; MLRO-only writes on Governance Contacts.

## Phase 10 acceptance
- [x] Superadmin-only Cutover Console live at `/admin/aml-v3-cutover`.
- [x] All eight V3 flags read + write via existing `feature-flags-admin`.
- [x] Recommended flip order rendered as the primary grouping.
- [x] Hard-exclusion baseline preserved.
- [x] No user-facing AML change, no schema change, no data migration.
