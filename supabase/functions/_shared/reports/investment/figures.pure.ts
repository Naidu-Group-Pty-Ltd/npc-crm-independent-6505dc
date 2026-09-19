/**
 * Locale-free figure formatting for composed report prose.
 *
 * These helpers exist once because the same string is composed in Deno (the
 * edge functions) and asserted in Node (the spec suite), and the two runtimes'
 * ICU grouping need not agree — the rule `financialEngine.pure.ts` formats
 * under. `condenseFacts.pure.ts` learned it first; the financial chapter
 * composer shares the implementation rather than a second copy, because two
 * copies of a thousands-separator is how one report disagrees with another
 * about the same number.
 */

export const num = (v: unknown): number | undefined =>
  (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

export const str = (v: unknown): string | undefined =>
  (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/** Thousands separation without consulting the runtime locale. */
export const groupThousands = (n: number): string =>
  String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** `$1,234` / `-$1,234`, rounded to the dollar; undefined stays undefined. */
export const money = (v: unknown): string | undefined => {
  const n = num(v);
  if (n === undefined) return undefined;
  const r = Math.round(n);
  return r < 0 ? `-$${groupThousands(Math.abs(r))}` : `$${groupThousands(r)}`;
};

/** `5.45%` with trailing zeros trimmed (`5%`, `5.4%`); undefined stays undefined. */
export const pct = (v: unknown): string | undefined => {
  const n = num(v);
  if (n === undefined) return undefined;
  return `${n.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')}%`;
};
