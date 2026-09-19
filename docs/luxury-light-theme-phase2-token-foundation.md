# Phase 2 — Luxury Light Token Foundation Through Branding System

Date: 2026-07-01

## Scope

Phase 2 tightens the token contract before any further component-level restyling. The goal is to make the approved Luxury Property Advisory Light palette the default light-mode baseline while preserving the existing Branding / White Label override path and keeping dark mode separate.

## Files in scope

- `src/branding/brand-defaults.ts`
- `src/branding/token-resolver.ts`
- `src/branding/__tests__/token-resolver.test.ts`
- `docs/luxury-light-theme-phase1-audit.md`

No routes, permissions, Supabase tables, or Branding page save/upload flows should change in this phase.

## Light-mode baseline contract

The default light token map is the source of truth for the luxury light baseline. It owns:

- Warm ivory page background: `--background`
- Graphite foreground/body text: `--foreground`
- Porcelain cards/popovers: `--card`, `--popover`
- Champagne/cream muted surfaces: `--muted`, `--dashboard-surface-muted`, `--surface-muted`
- Soft beige borders and inputs: `--border`, `--input`, `--dashboard-border-soft`, `--border-soft`
- Warm sand/porcelain sidebar and topbar surfaces: `--sidebar-background`, `--sidebar-surface`, `--topbar-background`, `--mobile-nav-background`
- Antique-gold emphasis defaults: `--primary`, `--accent`, `--ring`, `--dashboard-primary-strong`

## Brand override boundaries

Custom `primaryColor` and `accentColor` from the Branding page are allowed to influence semantic emphasis tokens only.

Allowed light-mode brand influence:

- `--primary`
- `--primary-foreground`
- `--primary-hover`
- `--accent`
- `--accent-foreground`
- `--ring`
- `--sidebar-primary`
- `--sidebar-primary-foreground`
- `--sidebar-accent`
- `--sidebar-accent-foreground`
- `--sidebar-ring`
- `--dashboard-primary-strong`
- `--dashboard-primary-soft`
- chart tokens

Protected luxury light surfaces:

- `--background`
- `--foreground`
- `--card`
- `--card-foreground`
- `--popover`
- `--popover-foreground`
- `--secondary`
- `--muted`
- `--muted-foreground`
- `--border`
- `--input`
- `--sidebar-background`
- `--sidebar-foreground`
- `--sidebar-border`
- `--dashboard-surface`
- `--dashboard-surface-elevated`
- `--dashboard-surface-muted`
- `--dashboard-border-soft`
- `--dashboard-border-strong`
- `--surface-1`
- `--surface-2`
- `--surface-3`
- `--surface-elevated`
- `--surface-muted`
- `--border-soft`
- `--border-strong`
- `--topbar-background`
- `--sidebar-surface`
- `--mobile-nav-background`

## Resolver implementation note

`createLightTokens` must start from `defaultLightTokenMap`. It may then layer brand-selected primary/accent values over allowed emphasis tokens. It must not derive broad dashboard surfaces from arbitrary user colours.

A code comment has been added in `src/branding/token-resolver.ts` to make this contract explicit for future edits.

## Dark-mode preservation contract

Dark mode remains structurally and visually separate:

- `createDarkTokens` starts from `defaultDarkTokenMap`.
- Dark surfaces remain dark defaults even when brand colours are selected.
- Brand colours may still influence dark emphasis, charts, rings, and active states as they did before.

Phase 2 tests now assert key dark surface tokens remain equal to `defaultDarkTokenMap` and do not accidentally reuse the luxury light baseline.

## Verification added

`src/branding/__tests__/token-resolver.test.ts` now verifies:

1. Light and dark maps are emitted.
2. Default primary fallback still works.
3. Provided primary colour is applied to both themes.
4. Chart palettes still emit 10 entries.
5. Primary foreground remains readable.
6. Critical semantic tokens remain present.
7. Default snapshots remain stable.
8. Protected light surfaces stay equal to `defaultLightTokenMap` when custom brand colours are selected.
9. Custom brand colours affect approved light emphasis tokens.
10. Dark surfaces stay equal to `defaultDarkTokenMap` and separate from the luxury light baseline.

## Reviewer note: how to see Phase 2 on the frontend

Phase 2 is token-foundation work. It may not look visually different if:

- the browser has `localStorage.theme = 'dark'`;
- the saved Branding setting has `darkModeDefault = 'dark'`;
- a Supabase `whitelabel_settings` row supplies custom brand colours/logos;
- the current user lacks access to `/white-label` via `white_label` permission.

To review the light baseline locally, force light mode using the app's theme control or clear the stored theme key in dev tools:

```js
localStorage.removeItem('theme')
```

Then ensure the Branding draft/default theme mode is light or system-light.

## Phase 2 acceptance status

- [x] Light defaults are owned by `defaultLightTokenMap`.
- [x] Dark defaults remain owned by `defaultDarkTokenMap`.
- [x] `resolveBrandTokens` remains the only token resolver.
- [x] Brand primary/accent values continue to affect semantic emphasis tokens.
- [x] Light surface tokens stay stable under custom brand colours.
- [x] Dark surface tokens stay separate from luxury light surfaces.
- [x] Token regression coverage exists before continuing to Phase 3.
