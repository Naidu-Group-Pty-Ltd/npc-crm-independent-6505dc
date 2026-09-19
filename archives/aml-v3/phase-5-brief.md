# AML/CTF Tri-Portal V3 — Phase 5 Brief

**Scope (report §11 Phase 5 — Regulatory & Assurance surfacing):** raise the visibility of AUSTRAC submission readiness across the Regulatory & Assurance workspace without altering any decision, submission, or step-up path. Gated by the new `aml_v3_regulatory_hub` feature flag (default `false`).

## Delivered

1. **Feature flag reserved.** `aml_v3_regulatory_hub` added to `public.feature_flags` (default `false`) and to `src/lib/aml/useAmlV3Flags.ts` (`regulatoryHub`). Existing four V3 flags unchanged.
2. **`src/components/aml/RegulatoryAssuranceHeader.tsx`** — read-only readiness ribbon:
   - Consumes `amlReportingApi.summary()` (existing edge fn) — no new endpoints.
   - Tone shifts to `success` / `warning` / `destructive` based on `awaiting_mlro` + `rejected`.
   - Chips for Draft / Awaiting MLRO / Approved / Submitted / Rejected.
   - Deep links to Monitoring, Investigations (capability-gated to `aml.investigate`), and Records.
3. **Surfaced inside three Regulatory & Assurance pages** (only when flag on):
   - `AmlAustracReporting`
   - `AmlMonitoring`
   - `AmlInvestigations`

## Guardrails honoured

- **Tipping-off / restricted-surface separation.** The header renders only for holders of `aml.report`; it never appears in Client Portal or Finance Portal and never lists case identifiers.
- **No mutations.** All write paths, MLRO approvals, submission attestations, and step-up prompts remain inside `AmlAustracReporting`.
- **Model B entitlement gate untouched.** No case creation or service-unlock affordances added.
- **No schema, no cron, no edge-function change.** Uses existing `aml-reporting` summary op.
- **Hard exclusions (Directives 9 & 12).** `AmlLaunchOps` and Provider Configuration remain byte-identical.
- **Legacy routes preserved.** `/admin/aml/monitoring`, `/admin/aml/investigations`, `/admin/aml/austrac`, `/admin/aml/records` all continue to resolve as before.

## Default runtime

Flag off → all three pages look byte-identical to Phase 4. Superadmin can flip `aml_v3_regulatory_hub` (or set `feature_flags.aml_v3_regulatory_hub = true`) to preview.

## Phase 5 → Phase 6 handoff

Ready for Phase 6 (full case workspace chronological build-out under `aml_v3_case_workspace`) once green-lit. No follow-up needed here.
