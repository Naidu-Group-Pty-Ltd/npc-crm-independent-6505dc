# AML/CTF Tri-Portal V3 — Phase 2 Brief

**Scope (report Directive 1):** move AML activation to the Command Center master client record via a "Start Client Compliance" surface. Preserves the human-confirmed activation guardrail and Model B legal-approval gate. Gated by `aml_v3_start_client_compliance` (default `false`).

## Delivered

1. **`StartClientComplianceButton`** (`src/components/clients/StartClientComplianceButton.tsx`).
   - Renders only when `feature_flags.aml_v3_start_client_compliance = true` AND the viewer holds at least `aml.view` — otherwise nothing.
   - Opens the existing `ActivateClientDialog`, prefilled with the client's UUID and display name.
   - No new edge function or schema change. Reuses `amlCasesApi.activateClient` which already enforces `human_confirmed = true`, Model B `legal_approval + program_version` gate, and hash-chained audit on `aml.case_events`.

2. **Command Center wiring** (`src/components/clients/ClientDetailsModal.tsx`).
   - Button placed in the header actions row next to Review / Send to Finance.
   - Uses `smartCapitalize` on primary contact names, per project name-handling standard.
   - Mobile-compact label variant.

## Guardrails honoured

- **Marketing leads never auto-create a case.** The activation surface is only reachable from an active master client record, and the click still requires a human to fill and submit the confirmation dialog.
- **Tri-portal separation.** Button is Command-Centre-only — no Client Portal or Finance Portal surface added.
- **Model B safety.** Dialog blocks Model B until tenant records `legal_approval + program_version`; server enforces the same regardless of client-side state.
- **Step-up / audit.** Unchanged. `activate_client` writes the activation event and case creation to the existing audit chain.
- **Hard exclusions (Directives 9 & 12).** Untouched.

## Default runtime

Flag is `false`, so the button does not render — Command Center is byte-identical to before. A superadmin can flip `aml_v3_start_client_compliance` to preview.

## Phase 2 → Phase 3 handoff

Ready to build the role-adaptive **Compliance Home** (Directives 5 & 6), gated by `aml_v3_compliance_home`. This will refactor `AmlOverview.tsx` into an action-led surface with the neutral continuation banner + "Open AUSTRAC Hub" affordance, deriving landing sections from effective permissions (not a client-side role string).
