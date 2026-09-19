# Phase 1 Audit — Luxury Light Theme + Branding Page Integration

Date: 2026-07-01  
Scope: `npc-property-dashbord` internal dashboard branding/theme pipeline before continuing visual implementation.

## Phase 1 goal

Phase 1 is intentionally an audit and contract-setting phase. The implementation must not treat the luxury light-mode refresh as a standalone CSS pass. The app already has a central Branding / White Label system, and all further work must flow through that system unless a file is explicitly identified as a shared UI primitive or semantic dashboard surface.

## Current high-level architecture

### Application provider chain

- `src/App.tsx` wraps the app in `BrandProvider` before `AuthProvider`, `PermissionsProvider`, `BrowserRouter`, notification providers, and dashboard routes.
- This means global theme settings, document title, favicon, token application, and White Label settings are already available before the internal dashboard layout renders.
- Any future visual implementation must preserve this provider position. Moving the brand provider lower would risk flashing unbranded tokens and breaking portal/auth surfaces.

### Branding route and permission contract

- The internal Branding page is implemented by `src/pages/WhiteLabel.tsx`.
- The route remains `white-label`, nested under the protected dashboard route.
- The route is protected by `ModuleGuard moduleKey="white_label"`.
- Desktop navigation defines the Administration item as `Branding`, with `url: '/white-label'` and `moduleKey: 'white_label'`.
- Mobile navigation has the same `/white-label` + `white_label` contract.

**Non-negotiable invariant:** do not rename `/white-label`, do not change the `white_label` permission key, and do not remove the existing Branding sidebar item.

## Branding data model and settings flow

### Core types

The central types live in `src/branding/brand-types.ts`:

- `ThemeMode`: `light | dark | system`
- `EmailSignatureSettings`: banner/contact/disclaimer fields
- `BrandThemeConfig`: primary/accent colour, dark-mode default, email signature
- `BrandLogoConfig`: auth, sidebar, sidebar icon, favicon
- `BrandConfig` / `WhiteLabelSettings`: flat legacy-compatible brand config plus structured config aliases
- `ResolvedBrandTokens`: `{ light, dark }`
- `BrandContextValue`: settings, updater, current theme state, and resolved token maps

### Default settings and tokens

The default branding contract starts in `src/branding/brand-defaults.ts`:

- `defaultBrandConfig` provides fallback company name, logos, colours, theme mode, email signature, and theme version.
- `defaultLightTokenMap` is the light-mode baseline for semantic Tailwind variables and dashboard-specific variables.
- `defaultDarkTokenMap` is independent and must remain visually unchanged for this project.

### Database mapping

`src/branding/BrandProvider.tsx` maps the Supabase `whitelabel_settings` row into the app's current `WhiteLabelSettings` shape.

Important compatibility behaviour:

- `theme_config` and `logo_config` JSONB values are preferred when present.
- Legacy flat columns remain supported for primary/accent colour, logos, favicon, theme default, and email signature fields.
- The provider produces both flat values and structured `themeConfig` / `logoConfig` values to avoid breaking older call sites.

### Update and persistence path

`BrandProvider.updateSettings`:

1. Merges new settings into current settings.
2. Rebuilds structured `themeConfig` and `logoConfig`.
3. Writes both structured JSON and legacy flat columns to `whitelabel_settings`.
4. Updates theme mode when `darkModeDefault` changes.

**Non-negotiable invariant:** future work must keep `BrandProvider` as the persistence and theme-token source of truth. Do not create a parallel theme store.

## Token resolution pipeline

### Current resolver

`src/branding/token-resolver.ts` resolves tokens as follows:

1. Normalize `primaryColor` and `accentColor` using defaults when missing.
2. Start light tokens from `defaultLightTokenMap`.
3. Override semantic primary/accent/ring/sidebar primary/sidebar accent/dashboard primary/chart tokens using user-selected colours.
4. Keep light-mode surface tokens mapped from default light surfaces.
5. Start dark tokens from `defaultDarkTokenMap`.
6. Override dark primary/accent/ring/sidebar/chart/dashboard emphasis tokens using user-selected colours.
7. Apply the chosen token map to `document.documentElement`.

### Surface stability rule

Brand primary/accent colours may influence actions, active states, focus rings, preview highlights, and charts. They must not blindly override:

- `--background`
- `--card`
- `--popover`
- `--dashboard-surface`
- `--dashboard-surface-elevated`
- `--dashboard-surface-muted`
- `--sidebar-background`
- body text/status semantics

The current test suite includes coverage asserting custom brand colours do not rewrite major light-mode surfaces.

## Theme application and browser identity

`BrandProvider` is responsible for browser-level branding:

- Applies `.dark` class to `document.documentElement` based on `light`, `dark`, or `system` mode.
- Applies resolved token maps as CSS variables.
- Updates `localStorage` key `theme`.
- Updates favicon and apple touch icon using the resolved favicon slot.
- Updates `document.title` and SEO/social meta fields from company name and favicon.

**Risk to watch:** if a user previously selected/stored `dark` in local storage, they will not see the light-mode work until theme mode is changed back to light/system-light. This is one likely reason front-end reviewers may not see light-mode changes.

## Asset resolution contract

`src/branding/brand-assets.ts` defines asset fallback order:

- `auth`: auth logo, sidebar logo, sidebar icon
- `sidebar`: sidebar logo, auth logo, sidebar icon
- `sidebar-icon`: sidebar icon, sidebar logo, auth logo
- `favicon`: favicon, sidebar icon, sidebar logo, auth logo

`src/components/branding/BrandAssets.tsx` renders those slots using `BrandLogo`, `BrandMark`, `BrandFavicon`, and `BrandLockup`.

**Non-negotiable invariant:** do not hard-code a fixed logo, company, or favicon into the dashboard, sidebar, preview, or hero. Use brand settings and asset fallback helpers.

## WhiteLabel / Branding page audit

`src/pages/WhiteLabel.tsx` is the control centre for Branding. It currently owns:

- `settings`, `updateSettings`, `isLoading`, `currentTheme` from `useWhiteLabel()`.
- `canEditWhiteLabel` from `useModulePermissions('white_label')`.
- Draft state and local draft restore.
- Change history and undo.
- Preset save/apply/delete.
- Asset validation for auth/sidebar/sidebar icon/favicon.
- Unsaved-changes route guard and before-unload guard.
- Company name, primary colour, accent colour, and theme default controls.
- Auth/sidebar/sidebar icon/favicon uploads.
- Email signature and email banner upload.
- Accessibility and asset checks.
- Save logic that blocks critical accessibility/asset failures.
- Activity logging for settings and logo changes.

### Save invariant

`handleSaveBranding` must remain functionally intact:

1. Block save on critical accessibility issues.
2. Block save while asset validation fails or is pending.
3. Call `updateSettings(draftSettings)`.
4. Clear persisted draft.
5. Reset local draft metadata/history.
6. Show success toast.
7. Log `whitelabel_settings_updated` activity.

Any future UI restyling must preserve this exact behaviour.

## Preview pipeline audit

`src/components/branding/BrandPreviewShowcase.tsx` is the correct place to preview unresolved/draft branding because it receives `settings` as a prop and calls `resolveBrandTokens(settings)` directly.

Current preview responsibilities:

- Preview draft light and dark token maps without requiring a save.
- Preview browser/fav icon resolution.
- Preview auth/sidebar assets via brand asset components.
- Demonstrate dashboard surfaces and semantic tokens.
- Ensure logos in the preview use draft `settings`, not only globally saved settings.

**Risk to watch:** any preview subcomponent that reads from `BrandProvider` without accepting the draft `settings` prop will show saved branding rather than the draft. Continue passing `settings` into `BrandLogo`, `BrandFavicon`, and `BrandMark` where previews are meant to be draft-based.

## Dashboard layout and semantic styling audit

### Layout files

- `src/components/layout/DashboardLayout.tsx` mounts desktop and mobile dashboard shells using `.dashboard-shell`.
- `src/components/layout/DashboardSidebar.tsx` mounts desktop sidebar surfaces and nav item classes.
- `src/components/layout/MobileSidebar.tsx` has a parallel mobile sidebar and must stay in sync with desktop Branding route/permission.
- `src/components/layout/DashboardHeader.tsx` and `src/components/layout/MobileHeader.tsx` use `.dashboard-topbar-surface` and `.dashboard-topbar-inner`.
- `src/components/layout/DashboardPageShell.tsx` wraps module pages with `DashboardThemeFrame`.
- `src/components/layout/DashboardThemeFrame.tsx` already provides shared variants: page, hero, section, sectionAccent, card, premiumCard, chartCard, toolbar.

### CSS semantic layer

`src/index.css` already contains the right global semantic hooks:

- `.dashboard-shell`
- `.dashboard-sidebar-surface`
- `.dashboard-topbar-surface`
- `.dashboard-panel`
- `.dashboard-kpi-card`
- `.dashboard-input-control`
- `.dashboard-icon-button`
- `.dashboard-theme-hero`
- `.dashboard-theme-section`
- `.dashboard-theme-card`
- `.dashboard-sidebar-menu-button-active`
- `.dashboard-sidebar-admin-group`
- mobile nav/sidebar equivalents

**Implementation rule:** future visual changes should prefer these existing semantic classes and shared primitives before adding page-specific Tailwind overrides.

## Tailwind token audit

`tailwind.config.ts` maps Tailwind colours to CSS variables:

- `background`, `foreground`, `card`, `popover`, `primary`, `secondary`, `muted`, `accent`, `success`, `warning`, `destructive`, `info`, `chart`, `sidebar` all resolve from CSS variables.
- This confirms token-level changes propagate broadly when components use Tailwind semantic classes.
- The dashboard-specific variables are used mainly in CSS rather than Tailwind config.

## Current Phase 1 findings / likely visibility issues

1. **Theme mode may be dark.** If local storage contains `theme=dark`, reviewers will not see light-mode changes because `BrandProvider` intentionally applies dark tokens and `.dark`.
2. **Branding page is permission-gated.** A user without `white_label` permission will not see `/white-label` even if the route exists.
3. **Hero images may be missing.** The new hero visual map references `/assets/light-mode/*.webp`. If those assets are absent, the component must fall back to gradients; reviewers should not expect photographic hero imagery until assets are added.
4. **Prior changes included primitive hook classes.** These are structural CSS hooks, not visible by themselves unless the app is in light mode and the CSS cascade reaches the relevant surfaces.
5. **Supabase settings can override defaults.** Existing saved `primaryColor`, `accentColor`, `darkModeDefault`, logos, and company name can make the app look different from default local expectations.

## Phase 1 output checklist

Before Phase 2 continues, confirm these invariants remain true:

- [x] `BrandProvider` stays at the root provider level.
- [x] `/white-label` route remains unchanged.
- [x] `white_label` module key remains unchanged.
- [x] Sidebar label remains `Branding`.
- [x] WhiteLabel save/draft/preset/upload/accessibility logic remains the source of truth.
- [x] `resolveBrandTokens` remains the token resolution source.
- [x] Light/dark token maps remain separate.
- [x] Brand asset resolution flows through `getBrandAssetSrc` and Brand asset components.
- [x] Dashboard visual work should continue through semantic classes and shared primitives.

## Recommended next phase entry criteria

Phase 2 should not add more page-specific styling yet. It should first tighten the token contract by:

1. Freezing the intended luxury light token values in `defaultLightTokenMap`.
2. Confirming `defaultDarkTokenMap` diff remains empty.
3. Ensuring user-selected brand colours only affect allowed semantic tokens.
4. Expanding token tests for custom primary/accent values and theme-mode selection.
5. Creating a local verification note for how to force light mode when reviewing the front end.
