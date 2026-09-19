# Phase 4 — Pipelines, timelines, kanban primitives

## Scope
Shared primitives for pipeline boards (Deal Pipeline, Finance Pipeline, PF Kanban)
and chronological rails (AML Chronological Timeline, PF audit trail, Deal history).
Non-invasive additions to `@/components/aurixa` — nothing in the existing pipeline
or timeline pages is touched. Migrations are opt-in for follow-up work.

## Deliverables

- `src/components/aurixa/KanbanColumn.tsx`
  - Header: tone dot, title, description, count chip, weighted-value chip.
  - WIP limit: renders `count/limit`; over-limit sets `data-over-limit` and
    swaps the border/ring to `--warning` tokens.
  - Drop-target state via `isDropTarget`; sets `data-drop-target` and a
    `--primary` ring so consumers can wire any DnD library without owning
    hover styles.
  - Slots: `headerSlot` (filters/sort), `footerSlot` (add-card CTA / load
    more). Scroll container gated by `scrollable`.
  - Semantic tokens only (`--glass-tint`, `--glass-hairline`, `--radius-xl`,
    `--elevation-*`, `--motion-*`).

- `src/components/aurixa/KanbanCard.tsx`
  - **Isolated drag handle** (`<button>` with `GripVertical`) so the card
    body can be a plain click target. Reduces accidental drags.
  - Title/subtitle with `line-clamp` for density.
  - `chips` slot for lender / status / category pills.
  - `daysInStage` micro-bar with tone escalation
    (primary → warning → destructive) driven by `daysInStageMax`.
  - `risk` pill (`low | medium | high`) → success / warning / destructive
    semantic tokens.
  - `assignee` avatar (avatarUrl or auto-initials).
  - `meta` list for amount / date / agency.
  - `focus-visible` rings on both drag handle and body button.
  - Full `motion-reduce` fallback.

- `src/components/aurixa/TimelineRail.tsx`
  - Vertical rail using `--primary` gradient plus per-event tone rings
    (default / success / warning / destructive / info).
  - Glass event cards with title, description, actor, timestamp, meta slot.
  - Filter chip strip driven by `filters` + `activeFilter` + `onFilterChange`.
    "All" chip prepended automatically.
  - Keyboard nav: `↑`/`↓` moves focus across cards, `Home`/`End` jumps to
    ends. Cards expose `data-timeline-event="true"` for focus scan.
  - Empty state slot for the "no events match this filter" case.

- `src/components/aurixa/index.ts` — barrel exports for `KanbanColumn`,
  `KanbanCard`, `TimelineRail` and their public types.

## Migration status

- **Deal Pipeline** (`/DealPipeline`) — no-op. The existing bespoke kanban is
  functional; the primitives are available for the next refactor pass.
- **Finance Pipeline** (`/finance/pipeline`) — no-op. Same reasoning; wiring
  is deferred to a dedicated Finance Portal follow-up so drag handlers keep
  their current DnD contract.
- **AML Chronological Timeline** — no-op. Primitive is ready for AML v3
  Chronological view; adoption gated by v3 cutover.
- **PF audit trail** — no-op. `AuditTrailTab` can adopt `TimelineRail` once
  the entity comment thread refactor lands (Phase 5 candidate).

The primitive-first, migrate-later approach mirrors Phase 3 and keeps the
phase strictly non-regressing.

## Verification

- `bunx tsgo --noEmit` — clean.
- No new `audit:style` violations (semantic tokens only — no `text-white`,
  no raw palette classes, no hex literals).
- Reduced-motion: card hover-lift and column ring transitions are gated
  behind `motion-reduce:` fallbacks.
- Keyboard: kanban drag handle is a real `<button>` with `focus-visible`;
  timeline supports `↑`/`↓`/`Home`/`End`.
- Accessibility: WIP badges expose `aria-label`, risk pill exposes
  `aria-label`, timeline uses `role="region"` + filter chips as
  `role="tab"` with `aria-selected`.

## Files changed

- `src/components/aurixa/KanbanColumn.tsx` (new)
- `src/components/aurixa/KanbanCard.tsx` (new)
- `src/components/aurixa/TimelineRail.tsx` (new)
- `src/components/aurixa/index.ts` (exports)
- `archives/ui-uplift/phase-4-brief.md` (this file)
