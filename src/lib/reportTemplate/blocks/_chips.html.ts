/**
 * Shared chip palettes for Compass visual blocks (HTML side).
 *
 * ## Why these colours resolve through tokens
 *
 * Every other block in this tree reads its colour as `token:<name>` with a hex
 * fallback — `resolveBindableColor(p.captionColor ?? 'token:muted', ctx, '#666')`
 * is the shape. The chips were the exception: eleven literal pairs with no
 * token reference at all, so a colourway could restyle a whole document and
 * the badges inside it stayed the same six colours. A family is 50 masters ×
 * 10 palettes precisely because a palette is meant to reach everything the
 * master draws.
 *
 * They are named `token:chip*` rather than repointed at the design system's
 * `positive` / `caution` / `negative` / `info`, and that is deliberate. Those
 * tokens are a different value — Chancery's `--color-positive` is `#157A3A`
 * against this chip's `#065F46` — so adopting them would change the drawn
 * colour of every badge on a design the owner has already accepted. **No
 * colourway declares a `chip*` token today, so every document renders exactly
 * as it did**; what changes is that a palette now HAS somewhere to say so.
 *
 * The ink/ground pairs stay pairs. A chip needs a tint behind a dark ink and
 * the two are chosen together; deriving one from the other by mixing would
 * make a colourway's override depend on arithmetic nobody asked for.
 */
import type { ResolveContext } from '../bindingResolver';
import { resolveBindableColor } from '../bindingResolver';
import { esc } from './_shared.html';

interface Pair { bg: string; fg: string }

/** The values every deployment draws today, and the fallback for each token. */
export const RATING_PALETTE: Record<string, Pair> = {
  Strong:   { bg: '#DCFCE7', fg: '#065F46' },
  Moderate: { bg: '#FEF3C7', fg: '#92400E' },
  Watch:    { bg: '#FEE2E2', fg: '#991B1B' },
  High:     { bg: '#FEE2E2', fg: '#991B1B' },
  Medium:   { bg: '#FEF3C7', fg: '#92400E' },
  Low:      { bg: '#DCFCE7', fg: '#065F46' },
};

export const CONFIDENCE_PALETTE: Record<string, Pair & { label: string }> = {
  Verified:          { bg: '#DCFCE7', fg: '#065F46', label: 'Verified' },
  Indicative:        { bg: '#FEF3C7', fg: '#92400E', label: 'Indicative' },
  Planned:           { bg: '#DBEAFE', fg: '#1E3A8A', label: 'Planned' },
  UnderConstruction: { bg: '#E0E7FF', fg: '#3730A3', label: 'Under construction' },
  Unverified:        { bg: '#F3F4F6', fg: '#374151', label: 'Unverified' },
};

/** What an unrecognised rating or confidence draws. */
const NEUTRAL: Pair = { bg: '#F3F4F6', fg: '#374151' };

/**
 * A confidence the record does not state draws no chip.
 *
 * `NotAvailable` used to draw a grey "N/A" pill — a placeholder wearing a
 * badge — and the owner's rule (14 Sep 2026) is that no placeholder reaches a
 * client document. One predicate, shared with the jsPDF twin (`_shared.ts`),
 * so the two presentations agree about which chips exist.
 */
export const UNSTATED_CONFIDENCE = /^\s*(?:n\/?a|not\s*available|notavailable|unavailable|none|unknown)?\s*$/i;

/**
 * Resolve a pair through the template's tokens, falling back to the literal.
 *
 * `ctx` is optional so the jsPDF-era call shape still works: with no context
 * there are no tokens to read and the literals are the answer, which is what
 * every caller got before.
 */
function paletteFor(name: string, pair: Pair, ctx?: ResolveContext): Pair {
  if (!ctx) return pair;
  return {
    bg: resolveBindableColor(`token:chip${name}Bg`, ctx, pair.bg),
    fg: resolveBindableColor(`token:chip${name}Fg`, ctx, pair.fg),
  };
}

export function chip(text: string, bg: string, fg: string, size = 8): string {
  return `<span style="background:${bg};color:${fg};font-weight:700;font-size:${size}pt;padding:2pt 6pt;border-radius:${size}pt;display:inline-block;white-space:nowrap;">${esc(text)}</span>`;
}

export function ratingChipHtml(rating: string, size = 8, ctx?: ResolveContext): string {
  const known = RATING_PALETTE[rating];
  const p = paletteFor(known ? rating : 'Neutral', known ?? NEUTRAL, ctx);
  return chip(rating, p.bg, p.fg, size);
}

export function confidenceChipHtml(conf: string, size = 7.5, ctx?: ResolveContext): string {
  if (UNSTATED_CONFIDENCE.test(String(conf ?? ''))) return '';
  const known = CONFIDENCE_PALETTE[conf];
  const p = paletteFor(known ? conf : 'Neutral', known ?? NEUTRAL, ctx);
  return chip(known?.label ?? conf, p.bg, p.fg, size);
}
