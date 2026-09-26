/**
 * The two units every report stylesheet writes a value in.
 *
 * Moved here from `css.pure.ts` unchanged, so the standard sheet and a chosen
 * design's rules (`templateDesignCss.pure.ts`) format a colour and a size the
 * same way. Two copies of `pt` is how one sheet came to print `10.50pt` beside
 * `10.5pt`.
 */
import { hexToRgb01 } from './color.pure.ts';

/** `#RRGGBB` → `rgba(r,g,b,a)`, so a palette role can carry a tint. */
export function alpha(hex: string, a: number): string {
  const [r, g, b] = hexToRgb01(hex);
  const to255 = (v: number) => Math.round(v * 255);
  return `rgba(${to255(r)},${to255(g)},${to255(b)},${Math.min(1, Math.max(0, a))})`;
}

/** Trim `10.50pt` to `10.5pt`; keeps the golden readable and the output small. */
export function pt(value: number): string {
  return `${Number(value.toFixed(2))}pt`;
}
