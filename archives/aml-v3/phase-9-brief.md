# AML V3 · Phase 9 — Organisation Settings, Governance Contacts & Tenant-Facing Deprecations

## Directives delivered
- **7. Rename Platform Administration → Organisation Settings.** `AmlConfiguration.tsx` title/description switch when `aml_v3_org_settings` is on. Workspace label in `AmlLayout.tsx` already reads "Organisation Settings" for V3.
- **8. Remove tenant-facing plan sales.** The "Plan & Entitlements" tab (and its route content) is hidden when the flag is on. Plan management stays in Aurixa Mission Control (external billing portal), consistent with the existing external-billing-navigation memory.
- **10. Consolidate branding.** Branding tab shows a callout linking to the central `/white-label` workspace; per-module colour/logo uploads are de-emphasised. The existing `BrandingPanel` (fonts, disclaimers, custom domain) still renders below so tenants keep AML-specific string overrides.
- **14. Compliance Leadership Contacts.** New `GovernanceContactsPanel` mounted as a "Contacts" tab under Governance & Contacts. Persists to `aml.tenant_settings.metadata.aml_governance_contacts` via `update_tenant_settings` (same additive pattern as the activation program — no schema change).

## Out of scope (per non-negotiables)
- Directive 9 (Launch Ops) and Directive 12 (Provider Configuration) — hard-excluded, untouched.
- No route deletions; every `/admin/aml/*` alias is preserved.

## Flag
- `aml_v3_org_settings` (default `false`) reserved in `feature_flags` and wired through `useAmlV3Flags`. Cache invalidates on session start; existing V3 flag list unchanged.

## Compliance guardrails
- Governance contacts only writable by users with MLRO capability (client gate + server-side capability enforced by `update_tenant_settings`). Non-MLRO users see a read-only banner.
- No leakage into Client Portal or Finance Portal: contacts panel and organisation-settings surface remain Command Centre-only.
- No changes to tri-portal scoping, step-up sessions, or the case engine.

## Files touched
- `src/lib/aml/useAmlV3Flags.ts` — added `orgSettings` key.
- `src/lib/aml/amlTenantApi.ts` — added `AmlGovernanceContacts` type + `getGovernanceContacts` / `updateGovernanceContacts` helpers.
- `src/components/aml/GovernanceContactsPanel.tsx` — new panel (five contact roles, email validation, dirty-state, MLRO gating).
- `src/pages/aml/AmlGovernance.tsx` — added "Contacts" tab behind the flag.
- `src/pages/aml/AmlConfiguration.tsx` — title/description swap, hidden Plan tab, central-branding callout.
- Migration — reserved `aml_v3_org_settings` in `public.feature_flags` (default off).

## Rollout
1. Flip `aml_v3_org_settings` per tenant when ready.
2. Verify Governance Contacts save/load (MLRO account) and non-MLRO read-only banner.
3. Confirm Plan & Entitlements tab is hidden; direct billing traffic to Aurixa Mission Control.
4. Confirm Branding tab callout links to `/white-label` and legacy AML-specific fields still save.
