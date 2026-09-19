# AML/CTF Tri-Portal V3 — Phase 1 Brief

**Scope (report §11 Phase 1):** primary navigation shell, Organisation Settings rename, legacy route housing, feature-flag reservation. No behaviour changes to case, transaction, or reporting engines. Hard exclusions (Directives 9 & 12) untouched.

## Delivered

1. **Feature flags reserved (all default `false`).** Migration inserts:
   - `aml_v3_nav` — switches AML shell to Version 3 navigation.
   - `aml_v3_start_client_compliance` — Phase 2 activation surface.
   - `aml_v3_compliance_home` — Phase 3 role-adaptive home.
   - `aml_v3_case_workspace` — Phase 4/6 case workspace.
   Reader: `src/lib/aml/useAmlV3Flags.ts` (sessionStorage-cached, safe fallback to `false`).

2. **V3 navigation shell (`src/components/aml/AmlLayout.tsx`).**
   Gated on `aml_v3_nav`. When off, legacy V2 shell renders byte-identically. When on:
   - Directive 2 — Customer Compliance secondary reduced to **Cases** + **My Queue** only. Verification / Screening / Risk / Ownership & Control / Funding & Finance remain routable (legacy aliases) but no longer appear in workspace nav — they will surface inside the case workspace in Phase 4/6.
   - Directive 3 — "Structures" → **"Ownership & Control"** / **"Counterparty Due"** (V3 places counterparty due under Transaction Compliance).
   - Directive 4 — "Finance handoff" → **"Funding & Finance"** (also renamed in the legacy shell for label consistency).
   - Directive 7 — "Platform Administration" → **"Organisation Settings"** (applied in both shells).
   - Directive 8 — Plans & Entitlements withdrawn from workspace navigation.
   - Directive 14 — Governance & Contacts is the default landing for Organisation Settings; the contacts register will be built inside the existing `AmlGovernance` page in a Phase 1 follow-up if the flag is enabled.

3. **Legacy routes preserved.** No changes to `src/App.tsx`. All 15 `/admin/aml/*` routes continue to mount their existing components; V3 nav simply re-groups them.

## Hard exclusions honoured

Untouched files (Directives 9 & 12):
- `src/pages/aml/AmlLaunchOps.tsx`
- `supabase/functions/aml-launch-ops/**`
- `supabase/functions/aml-provider-webhook/**`
- Provider sub-panel of `src/pages/aml/AmlConfiguration.tsx`

Grep-verified: this phase modifies only `AmlLayout.tsx` and adds `useAmlV3Flags.ts`.

## Verification

- Build: TypeScript compiles clean after the `WORKSPACES` local-alias fix.
- Runtime default: with all four flags at `false`, the shell renders the V2 five-workspace layout (with the cosmetic Directive 3/4/7 relabels). Tri-portal separation, step-up, hash-chained audit and `useAmlAccess` unchanged.
- Toggle path: a superadmin can set `aml_v3_nav = true` via the existing feature-flags surface to preview the V3 shell without any schema or code change.

## Phase 1 → Phase 2 handoff

Ready to build the Command Center "Start Client Compliance" activation surface on the master client record, gated by `aml_v3_start_client_compliance`. The `aml-cases.activate_client` op is already scaffolded from V2 — Phase 2 wires the front-end dialog and confirms the human activation event before any case is created.
