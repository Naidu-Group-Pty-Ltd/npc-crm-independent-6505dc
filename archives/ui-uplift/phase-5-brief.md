# Phase 5 — Modals, Drawers, Forms

## Deliverables

New Aurixa primitives (all exported from `@/components/aurixa`):

| Primitive | File | Purpose |
| --- | --- | --- |
| `GlassModal` + `GlassModalActions` | `src/components/aurixa/GlassModal.tsx` | Canonical dialog shell — `h-[90vh]` bounded, internal `ScrollArea`, aurora-tinted glass, sticky footer with destructive/secondary/primary slots. |
| `DetailDrawer` | `src/components/aurixa/DetailDrawer.tsx` | Right-side glass drawer for quick previews without leaving list context (Clients, Deals, Reports, Listings). |
| `Stepper` | `src/components/aurixa/Stepper.tsx` | Progress rail for multi-step forms; horizontal on ≥md, vertical on <md; supports complete / active / error / optional / jump-back states. |
| `FormField` | `src/components/aurixa/FormField.tsx` | Render-prop wrapper providing label, required marker, helper text, error text, hint counter, and full `aria-describedby` / `aria-invalid` wiring. |

## Design rules enforced

- No hardcoded palette / font. All tone comes from `hsl(var(--*))` and `var(--glass-*)` / `var(--aurora-*)` tokens.
- `motion-reduce:animate-none` on every animated surface.
- 44 px minimum tap target on close buttons (< sm).
- `ScrollArea` mandatory inside `GlassModal` body (per project memory rule).
- `Radix Dialog` Portal + Overlay preserved so ⎋ / outside-click / focus-trap behaviour is unchanged.

## Migration guidance (for later phases)

- Report generation wizards, client intake, PF creation, and AML case-open flows should adopt `GlassModal` + `Stepper` together.
- Row previews on Clients / Deals / Reports / Listings should adopt `DetailDrawer` to preserve list context (replaces deep-linked full-page modals).
- All new form fields should wrap their control in `FormField` for consistent error / helper wiring.

## Verification

- `bunx tsgo --noEmit` on the new files → clean.
- No existing dialogs migrated in this phase; behaviour of shipped modals is unchanged.
