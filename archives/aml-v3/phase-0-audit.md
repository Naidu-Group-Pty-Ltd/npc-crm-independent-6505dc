# AML/CTF Tri-Portal V3 — Phase 0 Audit & Guardrails

Source of truth: `Aurixa_AML_CTF_Tri_Portal_Streamlined_Lovable_Implementation_Report_v3.pdf`
Working audit for V3. Superseded companion: `archives/aml-v2/phase-0-audit.md` (V2, still valid where V3 is silent).

Phase 0 mandate (report §11 / Phase 0): establish a safe baseline and a traceable implementation map **without any user-facing change**. Inventory routes, components, edge functions, tables, permissions, feature flags. Bind Directives 1–15 to code. Baseline the two hard-exclusion surfaces (Launch Operations, Provider Configuration).

---

## 1. Route inventory (current — V2 shell)

Mount: `/admin/aml/*` in `src/App.tsx` (lines 378–395), wrapped by `AmlLayout`.

| Route | Component | Guard capability | V3 target workspace |
| --- | --- | --- | --- |
| `/admin/aml` | `AmlOverview` | (layout) | Compliance Home |
| `/admin/aml/intake` | `AmlIntakeQueue` (in `AmlShellPages.tsx`) | `aml.view` | Customer Compliance → My Queue (legacy alias) |
| `/admin/aml/cases` | `AmlCases` | `aml.view` | Customer Compliance → Cases |
| `/admin/aml/verification` | `AmlVerification` | `aml.view` | Legacy alias → case section `Identity & Screening` |
| `/admin/aml/screening` | `AmlScreening` | `aml.view` | Legacy alias → case section `Identity & Screening` |
| `/admin/aml/risk` | `AmlRisk` | `aml.view` | Legacy alias → case section `Risk & Decision` |
| `/admin/aml/counterparty` | `AmlCounterparty` | `aml.view` | Transaction Compliance → Counterparty Due |
| `/admin/aml/finance` | `AmlFinance` | `aml.investigate` | Case section `Funding & Finance` (renamed from Finance handoff) |
| `/admin/aml/transactions` | `AmlTransactions` | `aml.investigate` | Transaction Compliance → Transactions |
| `/admin/aml/monitoring` | `AmlMonitoring` | `aml.view` | Regulatory & Assurance → Monitoring |
| `/admin/aml/investigations` | `AmlInvestigations` | `aml.investigate` | Regulatory & Assurance → Investigations |
| `/admin/aml/austrac` | `AmlAustracReporting` | `aml.report` | Regulatory & Assurance → AUSTRAC Hub |
| `/admin/aml/records` | `AmlRecords` | `aml.view` | Regulatory & Assurance → Records & Retention |
| `/admin/aml/governance` | `AmlGovernance` | `aml.view` | Organisation Settings → Governance & Contacts |
| `/admin/aml/launch-ops` | `AmlLaunchOps` | `aml.view` | **HARD EXCLUSION — do not touch** (Directive 9) |
| `/admin/aml/configuration` | `AmlConfiguration` | `aml.configure` | **HARD EXCLUSION — Provider Configuration untouched** (Directive 12); non-provider settings migrate to Organisation Settings |

Client Portal AML: `PortalAml` on `/portal/aml`. Finance Portal AML surface: `AmlCaseSnapshot` at `/finance/.../aml-snapshot/:token` (whitelisted fields only per tri-portal separation).

## 2. Edge functions

`aml-access`, `aml-cases`, `aml-client-portal`, `aml-entities`, `aml-finance`, `aml-monitoring`, `aml-provider-webhook`, `aml-records`, `aml-reporting`, `aml-risk`, `aml-transactions`, `aml-verification`, `aml-ai-guardrail`, `aml-step-up`, `aml-release-gate`, `aml-resilience`, `aml-launch-ops`, `aml-tenant`.

Contracts to preserve unchanged in V3 unless a phase explicitly authorises change:
- Auth: JWT via `verifyAuth`; role resolution via `public.get_aml_roles_for_user`.
- Step-up: 15-min per-capability sessions (`aml.report`, `aml.configure`) — see `src/lib/aml/stepUpTokenStore.ts`.
- Hash-chained audit on `aml.case_events` and equivalents.

## 3. Tables (aml schema — SECURITY DEFINER RPC access only)

Preserve: `aml.cases`, `aml.case_events`, `aml.verifications`, `aml.screenings`, `aml.matches`, `aml.risk_scores`, `aml.counterparties`, `aml.counterparty_requests`, `aml.transactions`, `aml.monitoring_rules`, `aml.alerts`, `aml.edd_cases`, `aml.reports`, `aml.report_versions`, `aml.retention_schedules`, `aml.legal_holds`, `aml.retention_scans`, `aml.privacy_requests`, `aml.tenant_settings`, `aml.plan_tiers`, `aml.provider_configs`, `aml.provider_metrics_daily`, `aml.step_up_challenges`, `aml.step_up_sessions`, `aml.ai_action_approvals`, `aml.release_gates`, `aml.resilience_drills`, `aml.rollout_stage_history`, `aml.acceptance_scenarios`, `aml.risk_register`, `aml.consents`, `aml.handoff_tokens`, `aml.activation_events` (Model A/B).

No schema changes in Phase 0.

## 4. Permissions & feature flags

- Capabilities: `aml.view`, `aml.investigate`, `aml.report`, `aml.configure` (see `src/lib/aml/permissions.ts`).
- Roles: `analyst`, `reviewer`, `mlro`, `auditor` (see `src/hooks/useAmlAccess.ts`).
- Superadmin bypass preserved.
- Feature flag `aml_ctf` (kill switch) — preserved.
- **New V3 flags (Phase 0 reserves the keys; no runtime toggle yet):**
  - `aml_v3_nav` — switches primary shell to Version 3 four-workspace layout.
  - `aml_v3_start_client_compliance` — enables the Command Center master-record activation (Phase 2).
  - `aml_v3_compliance_home` — role-adaptive Compliance Home (Phase 3).
  - `aml_v3_case_workspace` — case-centred workspace (Phase 4/6).

Flags will be added to `feature_flags` in Phase 1 as `false` defaults so no user-visible change occurs in Phase 0.

## 5. Directive → code traceability

| # | Directive | Primary code touch-points (V3) | Phase |
| - | --- | --- | --- |
| 1 | Move activation to Command Center master client record (`Start Client Compliance`) | New surface on Clients page (e.g. `src/pages/Clients.tsx` + new `StartClientComplianceDialog`); orchestration in `aml-cases` (`activate_client` op already scaffolded) | 2 |
| 2 | Case-centred Customer Compliance (Cases + My Queue only) | `AmlLayout`, `AmlCases`, `CaseWorkspaceTabs` | 1, 4 |
| 3 | Rename Structures → Ownership & Control (**sub-nav only**) | `CaseWorkspaceTabs`, entity screens (`AmlEntities`/People & Ownership) | 1 |
| 4 | Rename Finance handoff → Funding & Finance (embed in case) | `AmlFinance` → case section; nav labels | 4 |
| 5 | Adaptive, action-led Home | `AmlOverview` refactor | 3 |
| 6 | Neutral continuation banner + Open AUSTRAC Hub | `AmlOverview` banner | 3 |
| 7 | Rename Platform Administration → Organisation Settings | `AmlLayout` nav; `AmlConfiguration` split | 1 |
| 8 | Remove tenant-facing Plans & Entitlements | `AmlConfiguration` (Plans panel) | 1 |
| 9 | **DO NOT MODIFY Launch Operations** | `AmlLaunchOps` — hard exclusion | Phase 0 baseline |
| 10 | Consolidate AML branding into platform branding | `AmlConfiguration` branding panel → link to White Label | 1 |
| 11 | Structured label editor for terminology | `AmlConfiguration` terminology JSON → new form | 7 |
| 12 | **DO NOT MODIFY Provider Configuration** | `AmlConfiguration` providers panel — hard exclusion | Phase 0 baseline |
| 13 | Relocate provider metrics away from daily workflow | Metrics widgets → integration-health area | 7 |
| 14 | Compliance leadership contacts | `AmlGovernance` contacts panel | 1 |
| 15 | Full chronological case workspace + progressive disclosure | `CaseWorkspaceTabs` full build | 4, 6 |

## 6. Hard-exclusion baseline (Directives 9 & 12)

Frozen files — no edits until V3 completes:
- `src/pages/aml/AmlLaunchOps.tsx`
- `supabase/functions/aml-launch-ops/**`
- Provider configuration panel inside `src/pages/aml/AmlConfiguration.tsx` (provider tabs / provider_configs sections)
- `supabase/functions/aml-provider-webhook/**`
- `src/pages/aml/AmlConfiguration.tsx` **provider sub-panel only** (other panels may move in later phases; the provider panel stays byte-identical)

Guard: any PR under `archives/aml-v3/` phases 1+ that touches these paths MUST reference an explicit exception in the phase brief and this document — otherwise revert.

## 7. Non-negotiable invariants carried from V2 (`archives/aml-v2/phase-0-audit.md`)

- Tri-portal separation. Client Portal / Finance Portal never render SMR, restricted case fields, or provider metrics.
- AML cases only for active clients after a human-confirmed activation event. Marketing leads never auto-create a case.
- Model A / Model B share one engine. Model B needs `legal_approval` + `program_version` before enabling in production.
- Restricted capabilities require step-up (15-min, per-capability).
- Every decision writes hash-chained audit incl. subject, connected persons, evidence refs, provider results, risk model, program version, approver.
- Never alter Supabase reserved schemas; every new `public` table needs explicit GRANTs.

## 8. Phase 0 acceptance evidence

- [x] Route inventory captured (§1).
- [x] Edge functions and tables enumerated (§2, §3).
- [x] Permissions/feature-flag position recorded, V3 flag keys reserved (§4).
- [x] Directive → code map produced (§5).
- [x] Hard-exclusion baseline recorded (§6).
- [x] Zero user-facing changes shipped in this phase.

## 9. Phase gate

Phase 0 is complete. Proceeding to Phase 1 requires:
1. This document reviewed.
2. No edits to Launch Operations or Provider Configuration surfaces during Phase 0.
3. Legacy `/admin/aml/*` routes remain live so Phase 1 can build V3 nav on top of aliases (per report §11 Phase 1 "Preserve legacy routes through safe redirects or privileged diagnostics").

## 10. V3 closeout (Phase 13)

V3 is functionally complete behind feature flags as of Phase 13. See
`archives/aml-v3/phase-13-brief.md` for the directive → phase closure
map, invariant sweep evidence, and the authoritative flag-flip
runbook. Hard exclusions (Directives 9 & 12) remain byte-identical to
the Phase 0 baseline recorded in §6.

