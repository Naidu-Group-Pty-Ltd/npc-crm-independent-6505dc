# Phase 0 — Repository Audit, Compliance Guardrails & Delivery Controls

Non-destructive baseline for the Version 2 streamlined AML/CTF tri-portal build.
No schemas, routes, or components are removed in this phase. Governance file: `/AGENTS.md`.

---

## 1. Current-state route map (`/admin/aml/*`)

Wired in `src/App.tsx` (376–393) and `src/components/layout/DashboardSidebar.tsx` (178–192).
All routes are wrapped in `<AmlGuard capability="…">`; step-up is enforced for `aml.report` and `aml.configure` via `src/components/aml/StepUpAuthDialog.tsx`.

| # | Route | Page component | Capability | Status | Target V2 workspace |
|---|-------|----------------|------------|--------|---------------------|
| 1 | `/admin/aml` | `AmlOverview` | `aml.view` | production | Compliance Home |
| 2 | `/admin/aml/intake` | `AmlIntakeQueue` (shell) | `aml.view` | placeholder | Customer Compliance › Register (filter=Intake) |
| 3 | `/admin/aml/cases` | `AmlCases` | `aml.view` | production | Customer Compliance › Case workspace |
| 4 | `/admin/aml/verification` | `AmlVerification` | `aml.view` | production | Customer Compliance › Case tab: Verification |
| 5 | `/admin/aml/screening` | `AmlScreening` | `aml.view` | production | Customer Compliance › Case tab: Screening |
| 6 | `/admin/aml/risk` | `AmlRisk` | `aml.view` | production | Customer Compliance › Case tab: Risk |
| 7 | `/admin/aml/counterparty` | `AmlCounterparty` | `aml.view` | production | Customer Compliance › Case tab: Structures |
| 8 | `/admin/aml/finance` | `AmlFinance` | `aml.investigate` | production | Customer Compliance › Case tab: Finance handoff |
| 9 | `/admin/aml/transactions` | `AmlTransactions` | `aml.investigate` | production | Transaction Compliance › Transactions |
| 10 | `/admin/aml/monitoring` | `AmlMonitoring` | `aml.view` | production | Regulatory & Assurance › Monitoring |
| 11 | `/admin/aml/investigations` | `AmlInvestigations` | `aml.investigate` | production | Regulatory & Assurance › EDD / Investigations |
| 12 | `/admin/aml/austrac` | `AmlAustracReporting` | `aml.report` | production (step-up) | Regulatory & Assurance › AUSTRAC Hub |
| 13 | `/admin/aml/records` | `AmlRecords` | `aml.view` | production | Regulatory & Assurance › Records & Privacy |
| 14 | `/admin/aml/governance` | `AmlGovernance` | `aml.view` | production | Regulatory & Assurance › Governance |
| 15 | `/admin/aml/launch-ops` | `AmlLaunchOps` | `aml.view` | production | Platform Administration › Launch Ops |
| 16 | `/admin/aml/configuration` | `AmlConfiguration` | `aml.configure` | production (step-up) | Platform Administration › Configuration |

All 16 legacy URLs MUST resolve after Phase 1 via alias/redirect.

## 2. Client Portal AML surfaces

- `src/lib/aml/amlPortalApi.ts` (`aml-client-portal` edge fn) → sections: `purchasing_structure`, `personal_details`, `purchase_profile`, `funding`; document upload via signed URL; consents; requirement progress.
- Portal guard: `src/components/portal/PortalProtectedRoute.tsx` (consent wall enforced).

## 3. Edge functions (18)

`aml-access`, `aml-ai-guardrail`, `aml-cases`, `aml-client-portal`, `aml-entities`, `aml-finance`, `aml-launch-ops`, `aml-monitoring`, `aml-provider-webhook`, `aml-records`, `aml-release-gate`, `aml-reporting`, `aml-resilience`, `aml-risk`, `aml-step-up`, `aml-tenant`, `aml-transactions`, `aml-verification`.

All are invoked via `src/lib/aml/invokeAmlFunction.ts` → `invokeSecureFunction` (60 s timeout). Portal fn uses `x-portal-session-token`.

## 4. Library layer (`src/lib/aml/`)

`amlCasesApi.ts`, `amlEntitiesApi.ts`, `amlFinanceApi.ts`, `amlMonitoringApi.ts`, `amlPortalApi.ts`, `amlRecordsApi.ts`, `amlReportingApi.ts`, `amlRiskApi.ts`, `amlTenantApi.ts`, `amlTransactionsApi.ts`, `amlVerificationApi.ts`, `invokeAmlFunction.ts`, `permissions.ts`.

Permission matrix (`permissions.ts`): analyst / reviewer / mlro / auditor → `aml.view | aml.investigate | aml.report | aml.configure`. Step-up capabilities: `aml.report`, `aml.configure`.

## 5. Data layer (schema `aml`, exposed via SECURITY DEFINER RPCs)

Referenced across the codebase and the traceability matrix in `docs/aml/traceability-matrix.md`:

- Cases + consents: `aml.cases`, `aml.consents`, `aml.questionnaire_responses`
- Verification / screening: `aml.verifications`, `aml.screenings`, `aml.matches`
- Risk: `aml.risk_scores`
- Structures: `aml.counterparties`, `aml.counterparty_requests`
- Finance handoff: `aml.handoff_tokens`
- Transactions: `aml.transactions`
- Monitoring: `aml.monitoring_rules`, `aml.alerts`, `aml.edd_cases`
- Reporting: `aml.reports`, `aml.report_versions`
- Records: `aml.retention_schedules`, `aml.legal_holds`, `aml.retention_scans`, `aml.privacy_requests`
- Tenant / providers: `aml.tenant_settings`, `aml.plan_tiers`, `aml.provider_configs`, `aml.provider_metrics_daily`
- Governance: `aml.step_up_challenges`, `aml.step_up_sessions`, `aml.ai_action_approvals`, `aml.release_gates`, `aml.resilience_drills`
- Launch Ops: `aml.rollout_stage_history`, `aml.acceptance_scenarios`, `aml.risk_register`

Public bridge: `public.get_aml_roles_for_user(_user_id uuid)` SECURITY DEFINER.
Feature flag: `feature_flags.aml_ctf`.

## 6. Existing docs (retain, do not overwrite)

`docs/aml/acceptance-scenarios.md`, `operator-quick-start.md`, `rollout-playbook.md`, `traceability-matrix.md`, `daily-weekly-ops.md`, `escalation-matrix.md`, `risk-register.md`, `shift-handoff.md`.

## 7. Guardrail confirmations (server-side)

- `AmlGuard` gates every route (flag + role + capability + step-up).
- `useAmlAccess` short-circuits to full-role set for `isSuperadmin`.
- Edge functions use `verifyAuth` + `invokeSecureFunction`; `aml-client-portal` uses portal session token.
- Step-up sessions are per-capability, 15 min, stored in `sessionStorage` keyed `aml_step_up_session:<cap>`.

## 8. Non-destructive migration backlog (blocks per phase gate)

| Phase | Deliverable | Blocking constraint |
|-------|-------------|--------------------|
| 1 | Five-workspace shell + legacy route aliases | Legacy URLs must 200-resolve; no capability regressions |
| 2 | Role-adaptive landings derived from effective permissions | No client-side role sniffing; restricted metric counts hidden | ✅ delivered — `suggestAmlLanding()` + capability-gated tiles/queues in `AmlOverview` |
| 3 | Hybrid activation engine (Model A/B) + Activate Client dialog | Requires `legal_approval` flag + `program_version` before Model B production |
| 4 | Case-centred Customer Compliance register | Preserves all Phase 4 sub-tables; case tabs replace top-nav pages | ✅ delivered — `CaseWorkspaceTabs` (Overview/Verification/Screening/Risk/Audit) inside case sheet; legacy `/admin/aml/{verification,screening,risk}` show `LegacyAliasBanner` and remain functional |
| 5 | Client Portal AML onboarding polish | Consent wall + resume/autosave; no restricted fields leak | ✅ delivered — consent gate locks stepper until 3 consents recorded, 1.2s debounced autosave on questionnaire drafts (skips submitted sections), resume jumps to last step / first incomplete section via `localStorage`, unmount flush prevents data loss. Portal view already filtered to safe fields (`status_label`, `sections`, `requirements`); no risk_rating / SMR / internal notes surfaced |
| 6 | Provider orchestration (IDV, PEP/sanctions, adverse media) | Simulator vs live provider isolation |
| 7 | Risk & decisions engine (policy-versioned, explainable) | Straight-through low-risk gate + controlled escalation |
| 8 | Finance Portal integration (handoff tokens, cross-portal RBAC) | No SMR/restricted data leak; duplicate doc-ref tests |
| 9 | Transaction Compliance + Seller Counterparty CDD | Threshold + IFTI/TTR triggers |
| 10 | Monitoring, EDD, existing customers, rules | Rescreen cron + alert lifecycle |
| 11 | AUSTRAC Hub | Cannot mark submitted without evidence; tipping-off tests |
| 12 | Records & governance | Retention holds, disposal, privacy requests |
| 13 | White-label entitlements | Terminology overrides, locked keys, disabled-feature removal from nav |
| 14 | Legacy route deprecation | Only after Phase 1–13 sign-off; keep audit-only aliases |
| 15 | UAT + launch (AS-01 → AS-13) | Release gate PASS + zero critical risk register items |

## 9. Baseline test set to preserve

Run before Phase 1 begins and record results:

- `bunx vitest run src/branding src/utils src/lib/aml` — unit tests
- Playwright: authenticated navigation across all 16 `/admin/aml/*` routes (superadmin + one AML-only user)
- Edge-function health check on all 18 `aml-*` functions (existing helper in `docs/aml/`)
- `docs/aml/acceptance-scenarios.md` AS-01…AS-13 run recorded in Launch Ops

## 10. Phase 0 acceptance

- [x] Route + component inventory documented (§1)
- [x] Client portal, edge fn, and lib inventories documented (§2–4)
- [x] Data layer inventory + guardrail confirmations documented (§5, §7)
- [x] Non-destructive per-phase backlog defined (§8)
- [x] `AGENTS.md` created with non-negotiable rules
- [x] Baseline test suite executed and recorded (§9) — see
  `docs/aml/phase-0r-takeover-assessment.md` §5 (2026-07-25 takeover baseline).
  Runnable-in-environment commands executed and recorded; `security:edge-check`
  and Playwright e2e were not runnable in the assessment container and are
  explicitly recorded as such with operator commands (issue I-16). Lint,
  `audit:style` and `security:registry` fail on unmodified `main` (issue I-02) —
  recorded, not silently fixed.

Phase 0 complete once §9 is signed off. Do not begin Phase 1 until then.
Takeover addendum (2026-07-25): the Phase 0R reconciliation of this audit against
the live deployed environment — including the migration parity gap, live feature
flag values and the empty production data state — is recorded in
`docs/aml/phase-0r-takeover-assessment.md`.
