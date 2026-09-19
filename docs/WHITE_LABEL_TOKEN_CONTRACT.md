# White-Label Token Contract

This document is the single source of truth for the dashboard's branding system.
All shared UI must consume semantic CSS tokens — never raw Tailwind palette
classes (`bg-blue-500`, `text-red-600`, etc.).

## Architecture

```
whitelabel_settings (DB)
   └── BrandProvider.mapDatabaseSettings()      ← legacy + structured merge
        └── resolveBrandTokens(BrandConfig)     ← derives light + dark maps
             └── applyBrandTokenMap()           ← writes CSS vars on :root
                  └── components consume tokens via Tailwind classes
```

Brand inputs (primary/accent colors, logos, theme mode) live in
`whitelabel_settings`. The `theme_config` and `logo_config` JSONB columns hold
the canonical structured form; the legacy flat columns remain for backward
compatibility and are still hydrated as fallbacks.

## Persistence Model

| Column            | Type    | Purpose                                                        |
| ----------------- | ------- | -------------------------------------------------------------- |
| `theme_config`    | jsonb   | Structured raw inputs: primary, accent, dark mode, signature   |
| `logo_config`     | jsonb   | Structured logo slots: auth, sidebar, sidebarIcon, favicon     |
| `theme_version`   | integer | Contract version. `2+` requires complete logo_config           |
| `primary_color`   | text    | Legacy fallback (still read by `mapDatabaseSettings`)          |
| `auth_logo` etc.  | text    | Legacy fallback (still read by `mapDatabaseSettings`)          |

A trigger (`validate_whitelabel_settings_payload`) enforces:

- `dark_mode_default ∈ {light, dark, system}`
- HSL string `H S% L%` or hex format for color fields
- `theme_config` and `logo_config` must be JSON objects
- `theme_version >= 2` requires all four logo slots to be set

## Token Categories

All tokens are HSL triplets without the `hsl()` wrapper, so consumers can
apply opacity via `hsl(var(--token) / 0.5)`.

### Base surfaces
`--background`, `--foreground`, `--card`, `--card-foreground`,
`--popover`, `--popover-foreground`, `--surface-1`, `--surface-2`,
`--surface-3`, `--surface-elevated`, `--surface-muted`,
`--dashboard-surface`, `--dashboard-surface-elevated`,
`--dashboard-surface-muted`

### Actions & focus
`--primary`, `--primary-foreground`, `--primary-hover`,
`--secondary`, `--secondary-foreground`, `--secondary-hover`,
`--accent`, `--accent-foreground`, `--ring`,
`--dashboard-primary-soft`, `--dashboard-primary-strong`

### Borders
`--border`, `--input`, `--border-soft`, `--border-strong`,
`--dashboard-border-soft`, `--dashboard-border-strong`

### Feedback
`--success`, `--success-foreground`, `--success-light`,
`--warning`, `--warning-foreground`, `--warning-light`,
`--destructive`, `--destructive-foreground`, `--destructive-light`,
`--info`, `--info-foreground`, `--info-light`

### Charts
`--chart-1` … `--chart-10` (derived by hue rotation from primary/accent)

### Navigation shells
`--sidebar-background`, `--sidebar-foreground`,
`--sidebar-primary`, `--sidebar-primary-foreground`,
`--sidebar-accent`, `--sidebar-accent-foreground`,
`--sidebar-border`, `--sidebar-ring`, `--sidebar-surface`,
`--topbar-background`, `--mobile-nav-background`

## Reusable Semantic Classes

Defined in `src/index.css`. Prefer these over ad-hoc utility stacks:

| Class                                | Purpose                                |
| ------------------------------------ | -------------------------------------- |
| `dashboard-status-chip`              | Base chip — neutral surface + border   |
| `dashboard-status-chip-success`      | Positive/confirmation tone             |
| `dashboard-status-chip-warning`      | Caution / pending tone                 |
| `dashboard-status-chip-destructive`  | Error / deletion tone                  |
| `dashboard-status-chip-info`         | Informational / "in flight" tone       |
| `dashboard-status-chip-accent`       | Brand accent (purple-pink in default)  |
| `dashboard-status-chip-neutral`      | Muted / inactive tone                  |
| `dashboard-section-band`             | Elevated section header surface        |
| `dashboard-chip-accent`              | Soft accent chip                       |
| `dashboard-nav-item`                 | Sidebar / topbar item base             |

## Component Migration Rules

✅ **Do**

```tsx
<Badge className="bg-success/10 text-success border-success/20">Active</Badge>
<div className="dashboard-status-chip dashboard-status-chip-warning">Pending</div>
<Card className="bg-card text-card-foreground border-border" />
```

❌ **Don't**

```tsx
<Badge className="bg-green-500 text-white">Active</Badge>
<div className="bg-yellow-100 text-yellow-800 border-yellow-300">Pending</div>
<Card style={{ background: "#fff", color: "#111" }} />
```

## Activity Log Tone Mapping

`src/pages/ActivityLogs.tsx` and `src/components/clients/ClientActivityTimeline.tsx`
use a 6-tone semantic palette. Map every new action type to one of:

- **success** — creates, completes, activates, sends successfully
- **warning** — edits, archives, threshold-triggered events
- **destructive** — deletions, deactivations, failures
- **info** — read-only events, generation, notifications
- **accent** — branding/whitelabel/tag actions
- **neutral** — logouts, deactivations, config switches

## QA Checklist (run before shipping a brand change)

- [ ] Primary color contrast against `--card` ≥ 4.5:1 (light + dark)
- [ ] Auth logo visible on auth surface (no transparent-on-transparent)
- [ ] Sidebar logo + collapsed icon both render at expected sizes
- [ ] Favicon updates in browser tab
- [ ] Charts remain distinguishable (no two adjacent slices at same hue)
- [ ] Status chips legible in light + dark for all 6 tones
- [ ] Empty / error states use `--muted-foreground`, not gray-500
- [ ] No `bg-{color}-{shade}` Tailwind palette classes in changed files

## Adding a New Token

1. Add the HSL value to **both** `defaultLightTokenMap` and
   `defaultDarkTokenMap` in `src/branding/brand-defaults.ts`.
2. If derived from brand inputs, extend `createLightTokens` /
   `createDarkTokens` in `src/branding/token-resolver.ts`.
3. Register the Tailwind alias in `tailwind.config.ts` if you want
   `bg-foo` shortcuts.
4. Add a snapshot assertion in
   `src/branding/__tests__/token-resolver.test.ts`.
5. Document the token in this file under the appropriate category.

## Tests

```bash
bunx vitest run src/branding/__tests__/token-resolver.test.ts
```

See `src/branding/__tests__/token-resolver.test.ts` for snapshot tests
that lock the default theme contract.
