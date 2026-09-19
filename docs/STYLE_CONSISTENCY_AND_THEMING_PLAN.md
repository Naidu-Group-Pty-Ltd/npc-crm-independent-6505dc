# Style Consistency & Dynamic White-Label Theming — Implementation Plan

**Status:** Proposed
**Owner:** Platform / UI
**Related:** [`WHITE_LABEL_TOKEN_CONTRACT.md`](./WHITE_LABEL_TOKEN_CONTRACT.md),
[`dashboard-theme-foundation.md`](./dashboard-theme-foundation.md),
[`luxury-light-theme-phase2-token-foundation.md`](./luxury-light-theme-phase2-token-foundation.md)

---

## 1. Objective

Establish a **single, consistent styling system** across the entire dashboard —
light **and** dark mode — where every surface (readings, cards, tables, modals,
forms, primary/secondary buttons, search, chips, badges, **and all text**) draws
from the **same set of semantic design tokens**.

Two behaviours must hold, and they are **different on purpose**:

1. **Brand tokens cascade dynamically** from the White-Label (branding) page. When
   an admin changes the brand colour or the brand font, the whole product re-skins —
   in both themes — with **no hardcoded HEX, no raw `amber/yellow` classes, and no
   per-component `font-family`** left behind.
2. **Semantic tokens stay fixed.** Warning (amber), error (red), success (green),
   and info (blue) carry *meaning*, not brand. They must **not** follow the brand
   colour. They still get correct light/dark values for contrast — they are simply
   never wired to the colour picker.

This document is an audit of the current state plus a phased plan to get there.

---

## 2. The Brand-vs-Semantic Model (read this first)

This is the single most important concept in the whole effort, and it is where the
current codebase — and the first draft of this plan — went wrong. **Colour has two
jobs, and they must be kept separate.**

### 2.1 Category A — Brand (cascades from the branding page)

Everything whose colour exists to express *identity*. When the brand colour
changes, these change, in both light and dark mode:

- Primary/secondary/accent **buttons** and their hover/active states
- **Links**, active/selected **navigation**, tabs, focus **rings**
- **Chart** accent series (derived from primary/accent by hue rotation)
- Brand **highlights / flourishes** (e.g. a "premium" gold border that is gold only
  because the brand is currently gold)
- The **brand accent** token (today's gold) — exposed as a named `--brand` token

### 2.2 Category B — Semantic / functional (fixed, never follows the brand)

Everything whose colour exists to convey *state or meaning*. These stay put even if
the brand becomes teal, purple, or navy:

| Meaning | Token | Colour family (stays) |
| --- | --- | --- |
| Caution / pending / needs attention | `--warning` | amber / yellow |
| Error / destructive / failure | `--destructive` | red |
| Success / complete / active | `--success` | green |
| Informational / in-flight / read-only | `--info` | blue |

They keep separate light/dark values for contrast, but the branding colour picker
**does not touch them**.

### 2.3 Category C — Neutral surfaces (fixed, optional subtle tint)

Backgrounds, cards, tables, borders, body text. These stay neutral for legibility.
At most they may receive a *very subtle* brand-hue tint, always clamped for contrast
via `getReadableForeground` / the accessibility helpers. Never washed in brand.

### 2.4 The migration's real work

The bulk of the effort is **not** "replace gold with a token." It is **classifying
each existing gold/amber usage as Category A or Category B**:

- Gold that means **"caution/pending/warning"** → `--warning` (Category B, **stays
  amber**, does **not** follow the brand).
- Gold that is **brand decoration** (gold only because the brand is gold) → `--brand`
  / `--primary` (Category A, **follows the brand**).

Because both look identical today, this classification is a human judgement call per
usage and cannot be a blind find-replace. Worked example of the intended result —
changing the brand colour to **teal**:

- ✅ Primary buttons, links, active nav, rings, brand accents, chart series → **teal**
  (light + dark)
- ✅ Warnings stay **amber**, errors **red**, success **green**, info **blue**
- ✅ Cards / tables / body text stay **neutral**
- ✅ Body/heading **font** follows the branding page's font selection (see §6)

---

## 3. Current State — What We Found

The architecture is already correct on paper. The problems are **incomplete
adoption**, a **monolithic stylesheet**, a **too-narrow White-Label surface**, and
**no typography system at all**.

### 3.1 The token pipeline exists and works

```
whitelabel_settings (DB)
  └── BrandProvider.mapDatabaseSettings()
       └── resolveBrandTokens(BrandConfig)     → light + dark BrandTokenMap
            └── applyBrandTokenMap()           → writes CSS vars on :root (inline style)
                 └── components consume tokens via Tailwind semantic classes
```

Files: `src/branding/BrandProvider.tsx`, `token-resolver.ts`, `brand-defaults.ts`,
`color-utils.ts`. Tailwind maps every semantic colour to `hsl(var(--token))`
(`tailwind.config.ts`). Defaults live in `src/index.css` `:root` / `.dark`.
**This part is good and must be preserved and extended, not rebuilt.**

### 3.2 Root cause of "changing White-Label doesn't cascade"

| Symptom | Cause |
| --- | --- |
| Gold persists in **light** mode after changing brand colour | Light-mode default `--primary` is **purple** (`262 66% 46%`). The gold you see is `--warning` (`43 74% 49%`) **and** ~4,960 hardcoded `amber/yellow` classes — none driven by White-Label. |
| It "sort of" cascades in **dark** mode only | Dark-mode default `--primary` **is** gold (`43 74% 49%`), so re-skinning primary *looks* like it works — but every hardcoded colour stays gold regardless of theme. |
| Only primary/accent respond | White-Label UI exposes **only** `primaryColor` + `accentColor` (no brand-accent, no font, no radius). |
| Fonts never change | There is **no** font token or font input anywhere (see §3.5). |

### 3.3 Hardcoding inventory (the real work)

Measured on the current branch:

| Metric | Count |
| --- | --- |
| `amber-*` / `yellow-*` Tailwind class usages (`bg/text/border/ring/from/to/via/fill/stroke`) | **~4,960** |
| Files touching `amber/yellow` classes | **272** |
| Hardcoded 6-digit HEX literals in `.tsx` | **~810** |
| Inline `style={{ color/background … }}` blocks | **~199** |
| `!important` in `index.css` (specificity debt) | **108** |
| `.dark ` scoped overrides scattered in `index.css` | **22** |

**Worst offenders (amber/yellow class count):**
`components/billing/TokenBalanceBanner.tsx` (312), `pages/RemindersHub.tsx` (88),
`pages/Conversations.tsx` (87), `pages/ClientManagement.tsx` (67),
`pages/Checklists.tsx` (51), `pages/CallLogs.tsx` (48),
`components/clients/PortfolioAnalysisReportsList.tsx` (48),
`pages/ReportRequests.tsx` (43), `components/clients/ClientComparison.tsx` (41).

**Known hardcoded gold hexes:** `#D4A017`, `#FFD700`, `#fbbf24`, `#eab308`,
`#ca8a04`, `#c9a227` across reminders, game-plan, call-logs, cash-flow, and PDF
generators. **Each must be triaged Category A vs B (§2.4).**

### 3.4 `src/index.css` is a 5,370-line monolith

One file mixes: the design-system `:root`/`.dark` token blocks, global resets,
markdown styling for Report Q&A, mobile safe-area utilities, density toggles, and
~30 feature-specific `@layer components` blocks (Report Q&A shell, chat bubbles,
"Phase 23 premium polish", etc.). Feature CSS living next to the design system with
no boundary is itself a source of inconsistency.

### 3.5 No typography system, inconsistent sizing & logo

- **No typography tokens whatsoever.** No `--font-*` variables, no `fontFamily` in
  `tailwind.config.ts`, no `@font-face`, no `@fontsource` packages. Type is entirely
  ad-hoc `text-*` utilities per component → inconsistent heading/label/body scales
  and font rendering across pages. **This is what the new font config must fix.**
- **Logo sizing differs per location** with no shared token: `DashboardSidebar`
  `h-10 max-w-[120px]`, `MobileSidebar` `h-8 max-w-[100px]`, `MobileHeader`
  `h-7 w-7`. (The "logo is large / inconsistent" complaint.)
- **Search UI is fragmented** — `SearchableSelect`, `SearchableMultiSelect`,
  `CommandPalette`, and ad-hoc inputs with no shared search-field style.

---

## 4. Target Architecture

Four layers, each with a clear owner and boundary:

```
Layer 1  BRAND INPUTS      whitelabel_settings + WhiteLabel.tsx
                           Colour: primary, accent, brand-accent (gold)
                           Type:   font family (sans/heading), base size, scale  ← NEW
                           Shape:  radius, density
                           (Semantic warning/success/error/info are NOT inputs)

Layer 2  TOKEN RESOLVER    token-resolver.ts derives full light+dark maps
                           - Category A (brand) tokens derived from brand inputs
                           - Category B (semantic) tokens = fixed constants
                           - Typography tokens applied from font inputs            ← NEW

Layer 3  DESIGN TOKENS     src/styles/tokens.css  (:root + .dark)
                           colour + typography + spacing/radius/density tokens

Layer 4  SEMANTIC CLASSES  src/styles/components.css + ui primitives
         + PRIMITIVES      buttons, cards, tables, modals, forms, search, chips,
                           text/heading primitives — token-only, theme-aware
```

**Golden rules (enforced by lint, not convention):**

1. No component uses a raw palette class (`amber-500`, `bg-yellow-100`) or a HEX/inline
   colour. Colour comes only from a semantic token/class.
2. No component sets its own `font-family`. Type comes only from the font tokens /
   registered Tailwind families.
3. Brand tokens are the **only** things wired to the branding page. Semantic tokens
   are fixed constants.

---

## 5. Colour Tokens — Brand vs Semantic Wiring

Concrete mapping of which tokens the resolver derives from brand input (Category A)
vs holds fixed (Category B/C). Extends `resolveBrandTokens` in `token-resolver.ts`.

### 5.1 Category A — derived from brand inputs (cascade)

| Token(s) | Derived from |
| --- | --- |
| `--primary`, `--primary-foreground`, `--primary-hover` | `primaryColor` |
| `--accent`, `--accent-foreground` | `accentColor` |
| `--brand`, `--brand-foreground`, `--brand-light` **(NEW)** | `brandAccent` (the named gold) |
| `--ring`, `--sidebar-primary*`, `--sidebar-accent*`, `--sidebar-ring` | primary/accent |
| `--dashboard-primary-strong`, `--dashboard-primary-soft` | primary |
| `--chart-1 … --chart-10` | hue-rotated from primary/accent — **in light mode too** (currently dark-only) |

### 5.2 Category B — fixed semantic constants (never cascade)

`--warning`, `--warning-foreground`, `--warning-light`,
`--success`, `--success-foreground`, `--success-light`,
`--destructive`, `--destructive-foreground`, `--destructive-light`,
`--info`, `--info-foreground`, `--info-light`.

These move to a clearly-labelled `SEMANTIC_TOKENS` constant so it is obvious they are
theme-only (light/dark), never brand-driven. **Fixes the "warnings shouldn't change"
requirement directly.**

### 5.3 Category C — neutral surfaces (fixed, optional subtle tint)

`--background`, `--foreground`, `--card*`, `--popover*`, `--surface-*`,
`--dashboard-surface*`, `--border*`, `--input`, `--muted*`, `--secondary*`. Kept
neutral; any brand-hue tint is optional and contrast-clamped.

---

## 6. Global Typography / Font Configuration (NEW — branding page)

Font selection becomes a **global brand setting**, chosen once on the White-Label
page and cascading to **every text component on every page** in both themes. No
component may declare its own `font-family` after this lands.

### 6.1 Font tokens

Add to `tokens.css` `:root` (with dark identical unless a brand overrides):

```
--font-sans:    <resolved from branding, fallback system stack>;
--font-heading: <resolved from branding, may equal --font-sans>;
--font-mono:    ui-monospace, SFMono-Regular, Menlo, monospace;   /* fixed */

/* type scale — consistent across all pages */
--text-xs … --text-3xl        /* sizes */
--leading-tight … --leading-relaxed
--font-weight-normal/medium/semibold/bold
--tracking-tight/normal
```

Register in `tailwind.config.ts`:

```ts
fontFamily: {
  sans:    ['var(--font-sans)',    ...defaultTheme.fontFamily.sans],
  heading: ['var(--font-heading)', 'var(--font-sans)', ...],
  mono:    ['var(--font-mono)',    ...defaultTheme.fontFamily.mono],
},
```

`base.css` sets `body { font-family: var(--font-sans) }` and
`h1–h6 { font-family: var(--font-heading) }` so the default cascades everywhere with
zero per-component work.

### 6.2 Font loading strategy (self-hosted, no external calls)

Offer a **curated allow-list** of fonts (e.g. Inter, Roboto, Open Sans, Lato,
Poppins, Source Sans 3, Playfair Display for headings, plus a "System default"
option). Self-host via **`@fontsource/*`** packages so there is **no runtime request
to Google Fonts** (deterministic, offline-safe, privacy-friendly). Each option maps
to a font stack string stored in the brand config.

- The selected family's `@fontsource` weights are imported once and made available;
  `BrandProvider` sets `--font-sans` / `--font-heading` from the saved value.
- A "System default" option maps to the native system stack (zero payload).
- Only allow-listed families are selectable — prevents arbitrary/invalid font strings
  and keeps the DB trigger validation simple.

### 6.3 Data model

Extend `BrandThemeConfig` (`brand-types.ts`) and `theme_config` JSONB:

```
fontFamily:        string | null   // key into the curated allow-list, e.g. "inter"
headingFontFamily: string | null   // optional; null → same as fontFamily
baseFontSize:      number | null   // optional global scale (e.g. 14/15/16px)
```

All nullable → backward compatible; null falls back to the system default in
`brand-defaults.ts`. Extend the Supabase `update` payload in `BrandProvider` and the
`validate_whitelabel_settings_payload` trigger to accept the new keys (font key must
be in the allow-list; size within a sane range).

### 6.4 Branding-page UI

Add a **Typography** section to `WhiteLabel.tsx`:

- Font-family picker (dropdown/preview of the curated list) for **body** and,
  optionally, **headings**.
- Base font-size control (S / M / L or px).
- **Live preview** rendering a heading + paragraph + button + table row in the
  chosen font, in **both light and dark**, next to the existing colour swatches.
- Reset-to-default control (mirrors the existing per-colour reset).

### 6.5 Migration

- Sweep components off ad-hoc `font-[...]`/hardcoded families onto the scale
  (`font-sans`/`font-heading` + `text-*` from the registered scale).
- Add lint rule forbidding `font-family` in component styles and `font-[` arbitrary
  values outside the token layer.

---

## 7. Phased Implementation Plan

Each phase is independently shippable and reviewable. Phases 0–3 are foundational
(low risk, high leverage); Phases 4–6 are the bulk migration; Phase 8 locks it in.

### Phase 0 — Guardrails first (½ day)

Ship enforcement **before** migrating so the count only goes down.

1. **ESLint rule** (`eslint-plugin-tailwindcss` or custom `no-restricted-syntax`)
   erroring on:
   - `className` containing `/(amber|yellow|green|red|blue|slate|gray|zinc)-\d{2,3}/`
   - inline `style` with literal `color`/`background`/`backgroundColor`
   - `font-family` in styles / `font-[` arbitrary values
2. **Stylelint** on `.css` — forbid raw hex outside `tokens.css` (`color-no-hex`,
   allow-list the token files).
3. **CI ratchet** — `scripts/audit-style-tokens.cjs` fails if the hardcoded-colour /
   font count rises above a recorded baseline. Ratchet down each PR.

**Exit:** new violations impossible; baseline recorded.

### Phase 1 — Split the monolith (1 day, mechanical)

Decompose `src/index.css` into `src/styles/`, imported in order:

```
src/styles/
  tokens.css        # :root + .dark — ALL tokens (colour brand+semantic, type, radius, density)
  base.css          # resets, transitions, body + heading font-family, focus-visible, a11y
  primitives.css    # button/card/table/modal/form/search/chip/text semantic classes
  markdown.css      # Report Q&A markdown (extracted)
  utilities.css     # mobile safe-area, scroll, density helpers
  features/*.css    # per-feature polish (report-qa.css, chat.css) — clearly scoped
```

`index.css` becomes a thin `@import` manifest. Pure extraction, verified by
screenshot diff — no visual change.

### Phase 2 — Complete the token set (1–1.5 days)

- **Add `--brand` / `--brand-foreground` / `--brand-light`** (named gold, Category A)
  and wire into `token-resolver.ts` for both themes.
- **Split `SEMANTIC_TOKENS`** (Category B) into a clearly-fixed constant so warnings
  et al. can never be brand-driven.
- **Add typography tokens** (§6.1) + register `fontFamily`/`fontSize` in Tailwind.
- **Add sizing tokens:** `--logo-height-sidebar`, `--logo-height-mobile`,
  `--logo-max-width` (plus existing `--radius`, density).
- Verify every token has a **light and dark** value.

### Phase 3 — Widen the White-Label cascade (2 days)

Make the branding page the true control surface for **Category A colour + fonts**,
while leaving Category B untouched.

1. **`token-resolver.ts`:** derive full brand palette (primary/accent/**brand**,
   rings, chart palette **in light too**) from inputs; keep semantic tokens fixed;
   keep legibility clamps.
2. **`brand-types.ts` + `theme_config` + trigger:** add `brandAccent`, `fontFamily`,
   `headingFontFamily`, `baseFontSize` (all nullable, validated). Optionally
   `radius`.
3. **`WhiteLabel.tsx`:** add **Brand Accent** colour control + the **Typography**
   section (§6.4), each with **side-by-side light+dark live preview**. Extend the
   Supabase `update` payload.
4. **Bump `theme_version`;** document new tokens/inputs in the token contract.

**Exit:** changing brand colour re-skins primary/accent/brand/charts/rings in both
themes; warnings/errors/success/info stay put; changing the font restyles all text.

### Phase 4 — Migrate shared primitives (2–3 days)

Highest fan-out first — one change fixes many screens. Each moves to token-only +
both-theme coverage:

- **Buttons** (`ui/button.tsx`): every variant uses `bg-primary/secondary/destructive`
  + `*-foreground` + `hover:bg-*-hover`. Add a `brand` variant backed by `--brand`.
- **Cards** (`card.tsx`): `bg-card text-card-foreground border-border`, elevation via
  `--surface-*`.
- **Tables** (`table.tsx` + data-table): header `bg-muted`, hover `bg-muted/50`,
  `border-border`; remove zebra hexes.
- **Modals/Dialogs/Sheets/Popovers:** `bg-popover`/`bg-card`, `border-border`,
  token-opacity overlay.
- **Forms** (input/select/textarea/checkbox/radio/switch/label): `bg-background`,
  `border-input`, `ring-ring`, `text-foreground`, `placeholder:text-muted-foreground`.
- **Search:** one `.field-search` primitive; refactor `SearchableSelect`,
  `SearchableMultiSelect`, `CommandPalette`, ad-hoc inputs onto it.
- **Badges/Chips/Status:** route through existing `dashboard-status-chip*` classes.
- **Text/Heading primitives:** shared `Heading`/`Text` (or `.text-heading-*`
  classes) so type is consistent and font-token-driven.
- **Logo:** one `<BrandLogo>` reading the size tokens; replaces the three divergent
  sidebar/mobile sizings (fixes "logo too large").

### Phase 5 — Migrate feature pages/components (bulk, staged)

Work the offender list (§3.3), biggest first. **Semi-automated codemod + mandatory
human review** — never blind replace, because the Category A vs B call (§2.4) is a
judgement per usage.

Classification mapping:

| Hardcoded usage | Meaning | → |
| --- | --- | --- |
| `amber/yellow` = caution/pending | **Semantic (B)** | `warning` / `dashboard-status-chip-warning` — **stays amber** |
| gold accent / brand highlight | **Brand (A)** | `brand` / `dashboard-chip-accent` — **follows brand** |
| `green-*` | Semantic | `success` |
| `red-*` | Semantic | `destructive` |
| `blue-*` | Semantic/brand (judge) | `info` or `primary` |
| `slate/gray/zinc-*` | Neutral (C) | `muted` / `border` / surfaces |
| `#D4A017 #FFD700 #fbbf24 #eab308 #c9a227` | judge per site | `hsl(var(--brand))` **or** `hsl(var(--warning))` |

Suggested batch order (ratcheting CI baseline down each PR):
`TokenBalanceBanner` → `RemindersHub` + reminders/* → `Conversations`/`Messages` →
`ClientManagement`/clients/* → `Checklists`/`ReportRequests`/`Agreements` →
`CallLogs`/call-logs/* → `gameplan/*` → `reports/*` (Cash Flow modal) → remainder.

**PDF/report generators** (`htmlRenderer.ts`, `_shared.html.ts`,
`FormaraPDFGenerator`, `PortfolioAnalysisPDFGenerator`) render static HTML/PDF and
**cannot read runtime CSS vars**. Give them a shared `brandPalette.ts` + font
resolved from the same brand config at generation time — one constants module, not
scattered hexes.

### Phase 6 — Typography adoption pass (1 day)

With font tokens live (§6), sweep components onto the type scale so headings, labels,
table text, and form text are consistent everywhere and honour the branding font.

### Phase 7 — Density / spacing / radius consistency (½ day)

Confirm `--radius` and density tokens are honoured across primitives; remove ad-hoc
`rounded-[…]` / arbitrary paddings that fight the tokens.

### Phase 8 — Verification & lock-in (1 day)

- **Visual regression:** Playwright screenshots of key screens (dashboard, a table
  page, a form/modal, reports) in **light + dark**, before/after each phase.
- **Cascade tests (automated):**
  - Set a non-gold brand colour → assert primary button / chart / ring change in both
    themes **and** that `--warning`/`--destructive`/`--success`/`--info` are
    **unchanged**.
  - Set a brand font → assert `body`/heading computed `font-family` changes app-wide.
- **A11y:** contrast check on resolved tokens (extend `branding/accessibility.ts`).
- **Ratchet to zero:** hardcoded colour/font baseline reaches 0 (allow-list only the
  token files + PDF palette module).
- Update `WHITE_LABEL_TOKEN_CONTRACT.md` with new tokens, font inputs, and the
  explicit Category A/B/C rules.

---

## 8. Effort & Sequencing Summary

| Phase | Scope | Risk | Est. |
| --- | --- | --- | --- |
| 0 Guardrails | lint/stylelint/CI ratchet (colour + font) | low | ½ d |
| 1 Split `index.css` | mechanical extraction | low | 1 d |
| 2 Complete tokens | brand + semantic split + type + size tokens | low | 1–1.5 d |
| 3 Widen cascade | resolver + WhiteLabel colour+font UI + DB | med | 2 d |
| 4 Primitives | buttons/cards/tables/modals/forms/search/text/logo | med | 2–3 d |
| 5 Feature migration | ~4,960 classes + ~810 hexes, staged, A/B triage | med (volume) | 5–8 d |
| 6 Typography adoption | type scale + brand font sweep | low | 1 d |
| 7 Density/radius | spacing consistency | low | ½ d |
| 8 Verify & lock | visual regression + cascade/font tests | low | 1 d |

Phases 0–4 deliver the "constant style system + colour/font cascade" the request
centres on; Phase 5 is the long tail that can land incrementally behind the ratchet.

## 9. Guiding Principles

1. **Brand cascades; semantic stays fixed.** Warning/error/success/info never follow
   the brand colour. This is the non-negotiable rule (§2).
2. **Preserve the working pipeline** — extend `token-resolver`, don't rebuild it.
3. **Tokens are the only colour source, font tokens the only type source** — enforced
   by lint, not convention.
4. **Every token is dual-theme** — no token ships without a light and a dark value.
5. **Migrate primitives before pages** — maximum leverage, minimum churn.
6. **Automate detection, classify by hand** — Category A vs B is a judgement call.
7. **Ratchet, never regress** — the hardcoded colour/font count only goes down.
