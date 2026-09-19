# Branding Page Audit and Guardrail Lock

Date: 2026-06-30

## Scope lock

This audit applies only to the existing Branding page in the Administration / White Label surface. It preserves the current component tree, page copy, data flow, draft workflow, upload workflow, validation rules, preview rendering, permissions, API/Supabase/storage calls, and route behaviour. No product data, brand assets, draft values, preset values, saved states, sync states, critical issue states, permission checks, or persistence behaviour are changed by this note.

## Theme foundation inspected

`docs/dashboard-theme-foundation.md` was inspected before touching the Branding page. The documented source of truth is the existing dashboard theme system, especially global CSS variables and Tailwind token classes:

- Background and text hierarchy: `--background`, `--foreground`, `bg-background`, `text-foreground`, `text-muted-foreground`.
- Card, elevated, form, upload, and preview surfaces: `--card`, `--dashboard-surface`, `--surface-1`, `bg-card`, `dashboard-panel`, `dashboard-section-band`, and `DashboardThemeFrame` variants such as `page`, `hero`, `section`, `sectionAccent`, `card`, `premiumCard`, `chartCard`, and `toolbar`.
- Borders and shell surfaces: `--border`, `border-border`, `--topbar-background`, `--sidebar-surface`, `bg-sidebar`, `text-sidebar-foreground`, `border-sidebar-border`.
- Brand accent and selected states: `--primary`, `text-primary`, `bg-primary`, `text-primary-foreground`, with gold reserved for primary actions, active tabs, selected states, and brand accents.
- Status colours: success/teal for ready/pass/saved/healthy states, warning/amber for draft/pending/caution/unresolved states, destructive/red only for critical/destructive/failed/invalid/reset/delete states, and muted/neutral tokens for passive metadata.
- Interaction treatment: preserve existing shadcn primitives, focus rings, hover states, card radius, shadow depth, and dashboard scrollbar conventions rather than introducing unrelated hardcoded colour systems.

## Branding implementation identified

The current Branding implementation is centred on `src/pages/WhiteLabel.tsx` and composes the following local and shared pieces:

- Page title, subtitle, and White Label indicator.
- `useWhiteLabel()` for settings, saving, loading, and runtime theme state.
- `useModulePermissions('white_label')` for edit permission gating.
- Local `draftSettings`, history, local draft persistence, preset persistence, leave guard, reset prompt, and preset dialog state.
- Brand System Draft command surface with sync/critical/asset status indicators plus undo, save draft, save preset, discard, reset, and save brand changes controls.
- How it works, company name, colour theme controls, primary/accent hex and HSL displays, swatches, dark-mode selection, light/dark/system choices, and runtime theme indicator.
- Logo upload cards for auth logo, sidebar logo, collapsed sidebar icon, and favicon, including replace/remove actions, upload handling, Supabase storage interaction, secure upload, and optional background removal.
- `BrandPreviewShowcase` for the live Dashboard / Client / Finance / Browser multi-surface preview.
- Asset validation cards for auth/sidebar/sidebar icon/browser readiness.
- `BrandAccessibilityPanel` for accessibility and brand health checks, including company name, primary action contrast, accent contrast, and asset coverage checks.
- Impact preview cards from `getBrandImpactPreview()`.
- Isolated Auth / Sidebar / Browser tab surface previews.
- Email Copilot Signature configuration, signature banner upload, signature detail fields, email signature preview, legal disclaimer textarea, and Reset Branding section.
- Existing loading, empty, error, validation, save, draft, preset, reset, upload, and preview states remain owned by the same components and hooks.

## Preserved dependencies and guardrails

The following dependencies and behaviours are intentionally preserved and should not be modified during Branding-only polish unless a visible containment, accessibility, or preview-rendering defect is explicitly fixed in the presentation layer:

- API/Supabase/storage: `supabase.storage`, `secureStorageUpload`, and the `branding-assets` bucket paths.
- Background removal: `removeBackground`, `loadImage`, and `blobToBase64` handling.
- Persistence: `loadPersistedDraft`, `savePersistedDraft`, `clearPersistedDraft`, `loadStoredBrandPresets`, and `saveStoredBrandPresets`.
- Brand resolution: `getBrandAssetSrc`, `resolveBrandTokens`, `defaultBrandConfig`, and `defaultEmailSignature`.
- Validation: `getBrandAccessibilityChecks`, `getBrandImpactPreview`, image dimension checks, critical contrast gating, invalid asset gating, and save enablement.
- Permissions and routing: `useModulePermissions('white_label')`, current Administration sidebar routing, authentication flow, and global dashboard behaviour.

## UI risks identified for future polish

- Long company names, URLs, email addresses, legal disclaimers, preset names, and validation details can pressure card layouts; future UI polish should use `min-w-0`, wrapping/truncation, and contained scrolling without changing values.
- Draft command bars and action groups can become cramped at tablet/smaller widths; future polish should wrap controls inside their existing container rather than hiding or changing actions.
- Upload zones and preview assets need strict `object-contain`, max-width/max-height limits, and non-stretching containers for logos, favicons, and signature banners.
- Multi-surface and isolated previews contain nested cards that may need controlled overflow handling on smaller screens.
- Light-mode treatment should retain sufficient contrast and surface separation using existing dashboard tokens rather than hardcoded colours.
- Critical, warning, pass, and neutral badges should keep their semantic colours so validation, readiness, and destructive/reset states are not visually diluted.
