# NPC Property Dashboard UI — conventions

A shadcn/ui component layer for an Australian property-services platform
(lending, conveyancing, AML/CTF compliance, builder and solicitor portals).
React + Tailwind, styled entirely through **semantic design tokens**.

## Setup

No global provider is needed for most components — import and render. Three
exceptions, each of which renders blank or warns without its wrapper:

- **`Tooltip`** must be inside **`TooltipProvider`**.
- **`SidebarTrigger`** and the other `Sidebar*` parts read `useSidebar()`.
  Outside **`SidebarProvider`** they log a warning and fall back to defaults.
  Note `SidebarProvider`'s wrapper is `min-h-svh` and does not forward
  `className` to that element — do not wrap small compositions in it.
- **`Toaster`** must be mounted once near the app root for toasts to appear.

Dark mode is class-based: put `class="dark"` on a root element. Every token
below flips automatically; never hand-write a dark variant for colour.

## Styling idiom: Tailwind utilities over semantic tokens

Style with Tailwind utility classes. **Only the semantic families below** — raw
palette utilities (`bg-blue-500`, `text-slate-700`) and hard-coded hex are
forbidden in shared UI and are enforced by a repo audit. They bypass the token
layer, so they neither follow white-label branding nor flip with dark mode.

| Purpose | Classes |
| --- | --- |
| Page / surface | `bg-background`, `bg-card`, `bg-popover`, `bg-muted`, `bg-accent` |
| Text | `text-foreground`, `text-muted-foreground`, `text-primary-foreground`, `text-card-foreground` |
| Brand | `bg-brand`, `text-brand`, `bg-brand-50` … `bg-brand-950` |
| Action | `bg-primary`, `bg-secondary` |
| Semantic state | `bg-success`, `bg-warning`, `bg-info`, `bg-destructive` (+ `-foreground`, `-light`) |
| Border / focus | `border-border`, `border-input`, `ring-ring` |
| Radius | `rounded-lg`, `rounded-md`, `rounded-sm` (all derive from `--radius`) |
| Type | `font-sans`, `font-heading`, `font-mono` |
| Charts | `bg-chart-1` … `bg-chart-10` — a categorical ramp; use these, not raw hues |
| Sidebar | `bg-sidebar`, `text-sidebar-foreground`, `border-sidebar-border` |

Tints use slash opacity on the same tokens (`bg-success/15`,
`border-destructive/30`) rather than a lighter palette step.

## Choosing between the badge components

`Badge` carries **identity** (`variant`: default, secondary, brand, outline,
success, warning, info, destructive). `StatusBadge` carries **lifecycle state**
(`tone`: neutral, success, warning, danger, info, brand, plus `dot`). For a
pass/fail/pending pill, prefer `<StatusBadge tone="…">` over
`<Badge variant="outline" className="bg-…">`.

## Where the truth lives

Read these before styling anything: the stylesheet closure at `styles.css`
(tokens, fonts, and the compiled component CSS), and each component's own
`.prompt.md` and `.d.ts` for its real prop contract. The `.d.ts` variant unions
are authoritative — e.g. `Button` has ten `variant` values and four `size`
values, several of which are specific to this system.

## Idiomatic example

```jsx
<Card>
  <CardHeader>
    <CardTitle>14 Marlborough Street, Balmain NSW 2041</CardTitle>
    <CardDescription>Settling 12 September 2026</CardDescription>
  </CardHeader>
  <CardContent>
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">Loan to value ratio</span>
      <span className="font-semibold text-foreground">75.0%</span>
    </div>
  </CardContent>
  <CardFooter className="gap-2">
    <Button>Open file</Button>
    <Button variant="outline">Valuation report</Button>
  </CardFooter>
</Card>
```

Layout glue is plain Tailwind (`flex`, `gap-2`, `justify-between`); everything
that carries colour, radius or type comes from the token families above.

## Known limitation

`Slider` renders a single thumb, so a two-value range does not draw correctly.
Use it for single values only.
