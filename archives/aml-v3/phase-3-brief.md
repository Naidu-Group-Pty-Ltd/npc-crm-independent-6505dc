# AML/CTF Tri-Portal V3 — Phase 3 Brief

**Scope (report Directives 5 & 6):** deliver the role-adaptive, action-led **Compliance Home**. Gated by `aml_v3_compliance_home` (default `false`). No schema, route, edge-function, cron, feature-flag registry or provider changes.

## Delivered

1. **`AmlComplianceHomeV3`** (`src/pages/aml/AmlComplianceHomeV3.tsx`).
   - Neutral continuation banner ("Continue where you work most") derived from `suggestAmlLanding(roles)` — no role chips, no dev metadata, no simple/advanced toggle (AGENTS.md §4).
   - Explicit **"Open AUSTRAC Hub"** secondary CTA in the banner, rendered only when the viewer holds `aml.report` and the primary landing is not already AUSTRAC.
   - Action-led **"Do next"** card lists capability-derived queues (Cases, Monitoring, Transactions, AUSTRAC, Funding & Finance, Organisation Settings). Uses V3 labels per Directives 4 & 7.
   - Metric tiles are strictly capability-gated:
     - Case tiles (Total / Open / Escalated) render for `aml.view`.
     - Monitoring tiles render only for `aml.investigate`.
     - Reporting SLA tiles render only for `aml.report` — never blurred placeholders, never leaked counts (tipping-off protection, AGENTS.md §2).
   - Actionable empty states for "no role assigned" and "no cases yet" — each explains the state and provides the next step.

2. **Flag-driven swap in `AmlOverview.tsx`.**
   - When `useAmlV3Flags().complianceHome` resolves `true`, the page renders `AmlComplianceHomeV3`.
   - When it resolves `false` (default), the V2 overview renders byte-identically. Legacy routes and behaviour unchanged.

## Guardrails honoured

- **Tri-portal separation.** V3 Compliance Home is Command-Centre-only. No Client Portal or Finance Portal surface added.
- **Effective permissions, not roles.** Landing recommendation and every visible tile/action route come from `hasAmlCapability(roles, …)`. Server-side `AmlGuard` continues to enforce on route entry.
- **Human-confirmed activation preserved.** Empty state explicitly re-states that cases are never auto-created from marketing leads.
- **Restricted surfaces stay restricted.** Reporting/configuration tiles do not render for users without the capability — no counts, no shadows, no placeholders.
- **Hard exclusions (Directives 9 & 12).** Untouched.
- **Legacy alias routes.** Untouched — the V3 home still links to `/admin/aml/*` paths already aliased.

## Default runtime

Flag is `false`, so Compliance Home renders exactly as it did after Phase 2. A superadmin can flip `aml_v3_compliance_home` to preview.

## Phase 3 → Phase 4 handoff

Ready for Phase 4 (case workspace consolidation) once green-lit — Verification, Screening, Risk, Structures and Finance handoff will fold into the case workspace behind `aml_v3_case_workspace`.
