# Phase 0 — Design System Audit & Primitive Gap Map

**Date:** 2026-07-27
**Owner:** UI Uplift (21st.dev-informed)
**Scope:** Read-only audit. No code changes. Establishes the baseline that
Phases 1–8 will regress against.

---

## 1. Style-token baseline (`npm run audit:style`)

Ratchet run at start of Phase 0:

| Metric | Baseline | Notes |
| --- | ---: | --- |
| `paletteClasses` (raw Tailwind palette in shared UI) | **4** | Close to zero — hold at 0 during uplift |
| `hexLiterals` | **844** | Regressed from ratchet floor 800 (+44). Concentrated in report/PDF generators (jsPDF), chart palettes, and legacy dashboards |
| `inlineColorStyles` | **340** | Regressed (+20). Same hot-spots as above |
| `fontHardcoded` | **97** | Regressed (+3). Mostly PDF renderers, but Phase 5/7 will sweep the UI hits |
| `cssHexOutsideTokens` | **25** | Regressed (+10). Live in `finance-portal.css`, `report-qa.css`, `components.css`. Must migrate into `tokens.css` |

**Success target (end of Phase 8):**
- `paletteClasses` = 0
- `hexLiterals` ≤ 590 (≥ 30 % reduction)
- `inlineColorStyles` ≤ 238 (≥ 30 %)
- `fontHardcoded` ≤ 68 (≥ 30 %)
- `cssHexOutsideTokens` = 0 (all hex lives in `tokens.css` only)

Ratchet floor should be re-set at the end of every phase so we can never
regress backwards.

---

## 2. Token inventory (`src/styles/tokens.css`)

### 2.1 Existing families

- **Core shadcn**: `--background`, `--foreground`, `--card`, `--popover`,
  `--primary` (+ `-hover`, `-foreground`), `--secondary`, `--muted`,
  `--accent`, `--border`, `--input`, `--ring`, `--radius`.
- **Semantic (fixed, non-brand)**: `--success`, `--warning`, `--destructive`,
  `--info`, each with `-foreground` and `-light` variants.
- **Chart 1–10**: for Recharts/LiveChart parity across the app.
- **Sidebar-specific**: `--sidebar-*` mirrored for shadcn sidebar.
- **Aurixa (dark-gold layer, both themes)**: `--aurixa-obsidian`,
  `--aurixa-aurora-1..3`, `--aurixa-glass-bg`, `--aurixa-glass-border`,
  `--aurixa-glow`, `--aurixa-hairline`.

### 2.2 Missing / to add in Phase 0.5 (still audit-only — will land in Phase 1)

The following tokens are not yet in `tokens.css` and are needed by the
primitives Phases 1–7 depend on. Definitions are **proposed here** and will be
landed in Phase 1 (first code-change phase):

| Proposed token | Purpose |
| --- | --- |
| `--elevation-1..4` | Box-shadow scale used by GlassCard, MetricTile, drawers |
| `--radius-sm/md/lg/xl` | Radius scale (currently only `--radius`) |
| `--motion-fast` (120 ms) / `--motion-base` (200 ms) / `--motion-slow` (320 ms) | Animation durations |
| `--motion-ease-out` / `--motion-ease-emphasized` | Cubic-bezier easings |
| `--space-1..12` | 4-px spacing scale reference (Tailwind spacing already covers it, we alias for JS-driven components) |
| `--aurora-gradient` | Composited gradient using aurora-1/2/3 |
| `--glass-tint` | rgba surface tint for cards over dark backgrounds |

### 2.3 Rogue values found in CSS (must move into `tokens.css`)

`cssHexOutsideTokens` = 25 hits. Files affected:

- `src/styles/finance-portal.css`
- `src/styles/report-qa.css`
- `src/styles/components.css`
- `src/styles/base.css` (one-off scrollbar tinting)

Action for Phase 1: promote every one of these hex literals to a named
token in `tokens.css` and reference `hsl(var(--…))` from the CSS module.

---

## 3. Primitive inventory (shipped vs. gap)

### 3.1 Shipped (Phase 1–7 legacy work)

| Primitive | Location | Consumers today |
| --- | --- | --- |
| `AurixaMark` | `src/components/agent/AurixaMark.tsx` | Agent chat, insights, plans |
| `AurixaSectionHeader` | `src/components/agent/AurixaSectionHeader.tsx` | Agent sub-pages, memory manager |
| `StatusPill` | `src/components/agent/StatusPill.tsx` | Insights, plans, skills |
| Aurora orb launcher | inside `AgentChatWidget.tsx` | Global agent surface |
| Glass modal shell | ad-hoc use of `bg-glass` + shadcn `Dialog` | Modals scattered across Clients / Deals / Reports |
| shadcn UI library | `src/components/ui/*` (57 primitives) | Everywhere |

### 3.2 Gaps — primitives to build

Grouped by the phase that will introduce them. **This section is the
authoritative "primitives shopping list" for Phases 1–7.**

| Primitive | Introduced in | Purpose |
| --- | --- | --- |
| `GlassCard` (formalised) | Phase 1 | Single component wrapping the ad-hoc `bg-glass` pattern with correct border, shadow, blur, motion |
| `MetricTile` | Phase 2 | Number + delta chip + sparkline, animated count-up, drill affordance |
| `KpiRow` | Phase 2 | Responsive grid of `MetricTile`s for landing pages |
| `SectionEmptyState` | Phase 3 (used in tables + everywhere) | Icon + heading + copy + primary/secondary CTA. Satisfies AGENTS.md rule "empty states must be actionable" |
| `DataTableToolbar` | Phase 3 | Search / column visibility / bulk action / density / export / saved views |
| `DataTableBulkBar` | Phase 3 | Slide-in bulk action bar on selection |
| `SegmentedTabs` | Phase 3 / 6 | Segmented control for view switching (replaces overloaded Tabs uses) |
| `AuroraHero` | Phase 2 / 7 | Hero band with AurixaMark, timestamp, category chip, single CTA |
| `TimelineRail` | Phase 4 | Vertical gold rail with glass event cards, filter chips, keyboard nav |
| `KanbanColumn` + `KanbanCard` | Phase 4 | Standardised deal/PF board cards with WIP limits, days-in-stage, risk pill |
| `GlassModal` + `Stepper` | Phase 5 | Standardised dialog shell + multi-step form scaffold |
| `DetailDrawer` | Phase 5 | Right-side drawer replacing full-page drill for list contexts |
| `SuggestionChips` | Phase 6 | AI chat suggestion strip |
| `ToolCallCard` | Phase 6 | Visual container for agent tool invocations |
| `TableOfContentsRail` | Phase 7 | Left TOC for `ReportViewer` |

### 3.3 Tri-portal parity gaps

The three portals do **not** currently share primitives consistently.
Current state:

| Surface | Command Centre | Finance Portal | Client Portal |
| --- | --- | --- | --- |
| Aurora header band | ad-hoc | ad-hoc | ad-hoc |
| Metric tiles | none | Batch 5/13 native cards | none |
| Glass cards | ad-hoc `bg-glass` | dedicated `.finance-card` CSS | ad-hoc |
| Empty states | ad-hoc | `FinanceEmptyState` (Batch 13) | ad-hoc |
| Modal shell | shadcn `Dialog` | shadcn `Dialog` | shadcn `Dialog` |
| Nav shell | `DashboardSidebar` | dedicated finance rail | dedicated client shell |

Phase 1 will promote `FinanceEmptyState` → shared `SectionEmptyState`, and
introduce a shared `AuroraHero` / `GlassCard` used by all three shells.
Finance-portal-only CSS in `finance-portal.css` will remain scoped to that
portal but will consume shared tokens (no local hex).

---

## 4. Route inventory

63 pages under `src/pages/`, organised by workspace:

```text
Command Centre    → /, /agent, /crm, /clients, /deals, /reports,
                    /listings, /market-updates, /model-hub,
                    /white-label, /integrations …
AML/CTF           → /aml/* (consolidated single sidebar entry)
Portals           → /portal/*  (client)
                    /finance-portal/*  (finance)
Calculators       → /calculators/*
Commercial/Ind.   → /commercial/*, /industrial/*
Admin             → /admin/*  (superadmin surfaces)
Q&A               → /qa/*
```

Priority pages for Phase 2 (highest-traffic landing surfaces):

1. `/` — Home / Command Centre dashboard
2. `/aml` — Compliance Home (role-adaptive)
3. `/finance-portal` — Finance dashboard
4. `/portal` — Client home

Priority pages for Phase 3 (data tables):

1. `/clients`
2. `/deals` (Deal Pipeline)
3. `/reports/generated`
4. `/listings`
5. `/call-logs`
6. `/market-updates` (list view)

Priority pages for Phase 4 (pipelines / timelines):

1. `/deals`
2. `/finance-portal/pipeline`
3. `/aml/timeline` (Chronological Timeline)

Priority pages for Phase 6 (AI surfaces):

1. `/agent` (Agent workspace)
2. `/qa` (Report Q&A)
3. Agent chat widget (global)

Priority pages for Phase 7 (report surfaces):

1. `/reports/:id` (ReportViewer)
2. `/reports/generated`
3. PDF cover generators (jsPDF pipeline)

---

## 5. Motion, spacing, and radius scale (proposed)

Duration scale (to be tokenised in Phase 1):

| Token | ms | Use |
| --- | --: | --- |
| `--motion-fast` | 120 | Hover state, focus ring, small tooltip |
| `--motion-base` | 200 | Modal open, drawer slide, tab switch |
| `--motion-slow` | 320 | Aurora bloom, count-up, timeline reveal |

Easing:

| Token | Curve |
| --- | --- |
| `--motion-ease-out` | `cubic-bezier(0.22, 1, 0.36, 1)` |
| `--motion-ease-emphasized` | `cubic-bezier(0.2, 0, 0, 1)` |

Radius:

| Token | rem | Use |
| --- | --: | --- |
| `--radius-sm` | 0.375 | Chips, small pills |
| `--radius-md` | 0.5 | Inputs, small cards |
| `--radius-lg` | 0.75 | Cards, dialogs (current `--radius`) |
| `--radius-xl` | 1.25 | Hero bands, feature cards |

Elevation (shadows, HSL to preserve theming):

| Token | Purpose |
| --- | --- |
| `--elevation-1` | Resting card |
| `--elevation-2` | Hover card, popover |
| `--elevation-3` | Dialog / drawer |
| `--elevation-4` | Floating command palette / toast stack |

Every animation must degrade to static under
`@media (prefers-reduced-motion: reduce)`. This is a Phase 8 gate but the
tokens must land in Phase 1 so consumers can adopt them progressively.

---

## 6. Accessibility snapshot (informational — deep pass is Phase 8)

- Semantic tokens already give WCAG AA contrast for `foreground/background`
  and `muted-foreground`, but the following hot-spots need Phase 8 verification:
  - Gold-on-obsidian numeric values in `MetricTile` (Phase 2).
  - `StatusPill` warning variant (amber-on-glass) on light theme.
  - Aurora hero heading on top of aurora gradient (Phase 2 / 7).
- Icon-only buttons in current headers (agent widget, model-hub) mostly have
  `aria-label` but a spot-check should be added to the Phase 8 checklist.
- Modals: `h-[90vh]` + `ScrollArea` rule already enforced in project memory.
- No custom keyboard nav for tables today; Phase 3 will add arrow-key row nav.

---

## 7. 21st.dev references (metadata only)

Kept for downstream phases; no code fetched.

| Phase | Reference | Use |
| --- | --- | --- |
| 1 | Dashboard Sidebar (arunjdass), Workbench Sidebar (nexus-ui) | Collapsible multi-tier nav shape |
| 1 | Command Palette (rafa-porto), Omni Command Palette | ⌘K palette pattern |
| 2 | Efferd Dashboard 2, Animated Dashboard Card, Analytics Dashboard | `MetricTile` composition |
| 3 | HeroUI Table, Data Table Filter, Complex Data Table, Leads Data Table | Toolbar, filters, bulk actions |
| 4 | UltraQualityKanbanBoard | Kanban card & column patterns |
| 6 | Glowing AI Chat Assistant, Message Dock, AI Suggested Actions | Agent widget composition |

All 21st.dev components will be re-tokenised to Aurixa semantics before merge.
Component code will be fetched via `get_component` only for the 2–3 exemplars
we actually adapt per phase, and never shipped with its own palette.

---

## 8. Traceability & next step

- This audit is the Phase 0 deliverable. It is complete and read-only.
- The **only** artefacts produced in this phase are:
  - `archives/ui-uplift/phase-0-audit.md` (this file).
  - Baseline audit-style counts captured above.
- The primitive gap map in §3.2, the token additions in §2.2, and the motion
  / radius / elevation scale in §5 are inputs to Phase 1 — they will be
  landed in code there, not here.

**Gate to Phase 1:** user's explicit "proceed with Phase 1" signal.
