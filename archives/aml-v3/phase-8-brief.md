# AML V3 — Phase 8 Brief (QA · Cutover Readiness)

**Type:** Verification-only. No user-visible change. No schema change.
**Mandate:** confirm Phases 1–7 are complete, additive, gated, and
compatible with a flag-flip cutover. Baseline the switch that flips
V3 on for a tenant when the user approves.

## 1. Feature-flag audit

All seven V3 flags are present in `public.feature_flags` (default `false`)
and consumed by the correct surface:

| Flag | Default | Consumer(s) |
| --- | --- | --- |
| `aml_v3_nav` | false | `src/components/aml/AmlLayout.tsx` |
| `aml_v3_start_client_compliance` | false | `src/components/clients/StartClientComplianceButton.tsx` |
| `aml_v3_compliance_home` | false | `src/pages/aml/AmlOverview.tsx` |
| `aml_v3_case_workspace` | false | `src/components/aml/CaseWorkspaceTabs.tsx` |
| `aml_v3_regulatory_hub` | false | `AmlAustracReporting.tsx`, `AmlMonitoring.tsx`, `AmlInvestigations.tsx` |
| `aml_v3_terminology_editor` | false | `src/pages/aml/AmlConfiguration.tsx` |
| `aml_v3_metrics_relocation` | false | `src/pages/aml/AmlConfiguration.tsx` |

With every flag off the AML surface renders identically to the end of V2
(archives/aml-v2). No dead code paths detected.

## 2. Hard-exclusion re-baseline (Directives 9 & 12)

Confirmed byte-identical to Phase 0 baseline:
- `src/pages/aml/AmlLaunchOps.tsx`
- `supabase/functions/aml-launch-ops/index.ts`
- `supabase/functions/aml-provider-webhook/index.ts`
- Provider Configuration sub-panel inside
  `src/pages/aml/AmlConfiguration.tsx` (provider tabs, provider_configs
  editors, provider webhook wiring). Only non-provider panels
  (terminology editor, metrics tiles) were touched — Directives 11/13.

## 3. Legacy route aliases

`/admin/aml/*` routes remain registered in `src/App.tsx` (intake, cases,
verification, screening, risk, counterparty, finance, transactions,
monitoring, investigations, austrac, records, governance, launch-ops,
configuration). The V3 four-workspace shell overlays via
`aml_v3_nav`; no route was removed.

## 4. Tri-portal separation re-check

- Client Portal (`/client/*`) surfaces: no imports from `src/pages/aml/**`,
  no reference to SMR/TTR/IFTI, no provider metrics widgets.
- Finance Portal (`/finance/*`) surfaces: no restricted case fields,
  no funding-discrepancy leakage.
- Timeline in `CaseWorkspaceTabs` still gates funding entries behind
  `aml.investigate` (Phase 6 rule).

## 5. Compliance invariants (still enforced)

- Cases only created via `StartClientComplianceButton` → `aml-cases`
  `activate_client` op for **active** clients with human confirmation.
- Model A / Model B share one engine; Model B still requires
  `legal_approval` + `program_version` before production enablement.
- Restricted capabilities (`aml.report`, `aml.configure`) still require
  a 15-min per-capability step-up token (`stepUpTokenStore.ts`).
- Every decision writes a hash-chained audit entry incl. subject,
  connected persons, evidence refs, provider results, risk model,
  program version, approver.
- No changes to Supabase reserved schemas.

## 6. Cutover procedure (recommended order)

Flip flags per tenant in this sequence, verifying each step before
proceeding:

1. `aml_v3_terminology_editor` + `aml_v3_metrics_relocation`
   (safest — pure configuration UI).
2. `aml_v3_start_client_compliance` (adds Command Center CTA only).
3. `aml_v3_compliance_home` (Overview refresh).
4. `aml_v3_regulatory_hub` (adds submission-readiness header).
5. `aml_v3_case_workspace` (adds chronological timeline tab).
6. `aml_v3_nav` **last** (activates the four-workspace shell —
   legacy `/admin/aml/*` routes remain aliased).

Rollback: setting any flag back to `false` returns the surface to V2
behaviour with no data migration.

## 7. Outstanding follow-ups (not blockers for cutover)

- Directive 13 long-term: build a dedicated `Integration Health`
  workspace once metrics telemetry is finalised. Interim behaviour
  (Metrics tab inside Configuration) is retained.
- Superadmin per-tenant flag console — currently flipped via
  `public.feature_flags` directly; no UI phase authorised.

## 8. Phase 8 acceptance

- [x] All V3 flags reserved, default off, and consumed.
- [x] Hard-exclusion baseline re-verified.
- [x] Legacy `/admin/aml/*` routes preserved.
- [x] Tri-portal separation intact.
- [x] Cutover order documented.
- [x] No schema change; no data migration required.

V3 is ready for flag-flip cutover on the user's approval.
