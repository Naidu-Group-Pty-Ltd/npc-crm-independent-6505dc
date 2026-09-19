/**
 * Shared visual language for the Add New Client → Advanced experience.
 * Presentation only — semantic tokens, no hardcoded colours.
 */

/** Panel surface: charcoal card, hairline border, controlled elevation. */
export const advSurface =
  'overflow-hidden rounded-2xl border border-border/55 bg-card/95 shadow-[0_1px_0_0_hsl(var(--border)/0.35),0_18px_34px_-26px_hsl(var(--background))] transition-[border-color,box-shadow] duration-150 focus-within:border-brand-300/35 motion-reduce:transition-none';

/** Panel header strip sitting on top of `advSurface`. */
export const advPanelHeader = 'border-b border-border/45 bg-background/45';

/** Uppercase micro eyebrow used above panel titles. */
export const advEyebrow = 'text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground';

/** Field label — small, high contrast, tight tracking. */
export const advLabel =
  'block text-[11px] font-semibold uppercase tracking-[0.07em] text-foreground/75';

/** Input / select / date control. */
export const advField =
  'h-11 w-full min-w-0 max-w-full rounded-lg border border-border/70 bg-background/70 px-3 text-sm text-foreground shadow-[inset_0_1px_0_hsl(var(--foreground)/0.04)] transition-[border-color,box-shadow,background-color] duration-150 placeholder:text-muted-foreground/70 hover:border-border focus-visible:border-brand-300/60 focus-visible:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35 disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none aria-[invalid=true]:border-destructive aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-destructive/25';

/** Compact metric tile. */
export const advKpi =
  'min-w-0 rounded-xl border border-border/55 bg-background/50 px-3.5 py-2.5 text-right';

/** Sub-card nested inside a panel (address block, applicant snapshot…). */
export const advSubCard =
  'rounded-xl border border-border/55 bg-background/45 transition-[border-color,background-color] duration-150 focus-within:border-brand-300/40 focus-within:bg-background/70 motion-reduce:transition-none';
