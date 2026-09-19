# Phase 7 — Reports & PDF surfaces

## Scope

Presentation-only primitives for long-form report surfaces (ReportViewer,
InvestmentReportViewer, GeneratedReports index, PDF cover pages).

## Files added

- `src/components/aurixa/ReportTocRail.tsx` — sticky left TOC rail with
  IntersectionObserver-driven active-section highlighting, offset-aware
  smooth scroll, keyboard-focusable buttons, glass hairline surface.
- `src/components/aurixa/ReportActionDock.tsx` — floating right-edge
  action cluster (copy link / share / print / download + `extraActions`),
  transient copied-state cue, tooltip labels, `role="toolbar"` a11y.
- `src/components/aurixa/ReportCoverHero.tsx` — standardised cover
  wrapper over `AuroraHero` with brand mark, category chip, canonical
  property key, generated-at timestamp. All token-driven.
- `src/components/aurixa/ReportGroupedList.tsx` — grouped index primitive
  for the Generated Reports page (by category / by property / by client)
  with collapsible glass sections and per-item render prop.
- Barrel export updated in `src/components/aurixa/index.ts`.

## Design notes

- Every surface consumes `--glass-hairline`, `--aurixa-glass-bg`,
  `--elevation-*`, `--radius-*`, `--motion-*`. Zero raw palette classes.
- Action dock is `hidden md:flex` so mobile viewports fall back to inline
  action buttons in the page shell (consistent with existing PWA layout).
- TOC rail is `hidden lg:flex`; below `lg` the caller is expected to
  surface a bottom-sheet TOC (out of scope for Phase 7 primitives).
- `ReportCoverHero` is print-safe by design: colours resolve to tokens
  that the print stylesheet already flattens.

## Verification

- `tsgo --noEmit` on the new files → clean.
- No backend changes; no edge-function or migration touch.

## Follow-ups (not part of Phase 7 primitives)

- Wire `ReportTocRail` + `ReportActionDock` into `src/pages/ReportViewer.tsx`
  and `InvestmentReportViewer.tsx` behind the `ui_uplift_v2` flag.
- Adopt `ReportCoverHero` in `PixelPerfectPDFGenerator`, `HybridPDFTemplate`,
  and `ClientPDFTemplate` cover slots.
- Introduce a "group by" segmented control on `GeneratedReports.tsx` that
  feeds `ReportGroupedList`. URL-synced, mirroring the Listings pattern.
