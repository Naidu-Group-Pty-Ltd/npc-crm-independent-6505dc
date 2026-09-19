/**
 * Did the model invent a number?
 *
 * ## Why this direction, and only this direction
 *
 * Enrichment hands a model a chapter of somebody's financial document and asks
 * it to lay the chapter out. The dangerous failure is not that it drops a
 * figure — a chapter that omits something is visibly short, and the source is
 * one click away on the review screen. The dangerous failure is that it
 * *produces* one: a total the chapter never totalled, a percentage derived from
 * two others, a rounded restatement of a rate. Those look authoritative, sit in
 * a document with a client's name on the cover, and are wrong.
 *
 * So the check runs **enriched → source**: every figure in the output must
 * appear in the input. Nothing requires the reverse.
 *
 * ## What counts as a figure
 *
 * Currency, percentages, grouped thousands, decimals, and plain integers above
 * a floor. The floor is what stops the check from being useless: `2` and `3`
 * appear in almost any English sentence a model writes legitimately at
 * `connective` or `rewrite` — "the two scenarios", "three conditions" — and
 * flagging them would make every chapter fail. Years are excluded for the same
 * reason at the other end: a model writing "the 2026 assessment" from a chapter
 * dated `01/03/2026` is not inventing anything, but the date's digits do not
 * survive as a bare `2026` token.
 *
 * ## Canonicalisation
 *
 * `$856,932`, `856932`, `856,932.00` and `856932.0` are one figure. Comparing
 * the printed strings would reject the model for correctly reading a currency
 * amount out of a table cell and putting it in a KPI value. So both sides are
 * parsed to numbers and rounded to two decimals — which also disposes of
 * `9.440000000000001`, a value this codebase produces whenever a rate is summed
 * before it is displayed.
 *
 * Presence, not multiplicity: a figure that appears once in the source may
 * appear three times in the output. A KPI strip and a table legitimately show
 * the same number.
 */

/** Below this, a bare integer is a count or an ordinal, not a figure. */
export const BARE_INTEGER_FLOOR = 12;

/** A bare four-digit number in this range is a year. */
export const YEAR_MIN = 1900;
export const YEAR_MAX = 2100;

/**
 * Every numeric token in a piece of text.
 *
 * Matches an optional currency symbol, digits with optional thousands
 * separators, an optional decimal part, and an optional trailing percent —
 * because `9.44%` is one figure and `9` and `44` are not.
 */
const FIGURE = /[-(]?\s*\$?\s*\d[\d,]*(?:\.\d+)?\s*%?\)?/g;

/** `$1,234.50` → 1234.5; `(2,000)` → -2000; `9.44%` → 9.44. */
export function canonicaliseFigure(token: string): number | null {
  const t = token.trim();
  const negative = /^-/.test(t) || /^\(.*\)$/.test(t);
  const digits = t.replace(/[^\d.]/g, '');
  if (!digits || !/\d/.test(digits)) return null;
  // A token with two dots is a date or a version, not a figure.
  if ((digits.match(/\./g) ?? []).length > 1) return null;
  const n = Number(digits);
  if (!Number.isFinite(n)) return null;
  return Math.round((negative ? -n : n) * 100) / 100;
}

/** True when a token is too ordinary to be worth checking. */
function ignorable(token: string, value: number): boolean {
  const bare = !/[$,.%]/.test(token);
  if (!bare) return false;
  const abs = Math.abs(value);
  if (abs <= BARE_INTEGER_FLOOR) return true;
  return Number.isInteger(value) && abs >= YEAR_MIN && abs <= YEAR_MAX;
}

export interface ExtractedFigure {
  /** As written. Kept so a rejection can quote it. */
  token: string;
  value: number;
}

/** Every figure worth checking, in order, deduplicated by value. */
export function extractFigures(text: string): ExtractedFigure[] {
  const source = String(text ?? '');
  const seen = new Set<number>();
  const out: ExtractedFigure[] = [];
  for (const m of source.matchAll(FIGURE)) {
    const token = m[0].trim();
    const value = canonicaliseFigure(token);
    if (value === null) continue;
    if (ignorable(token, value)) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    out.push({ token, value });
  }
  return out;
}

/**
 * Every figure in a source, as a set of canonical values.
 *
 * Unlike `extractFigures` this keeps the ordinary ones — the floor exists to
 * stop the *output* side raising false alarms, and a source that genuinely says
 * "3" should satisfy an output that says "3".
 *
 * One conversion is deliberately not accepted: a source writing `0.0944` where
 * the output writes `9.44%`. Rescaling a rate is computing, and computing is
 * the thing being forbidden.
 */
export function figureSet(text: string): Set<number> {
  const set = new Set<number>();
  for (const m of String(text ?? '').matchAll(FIGURE)) {
    const value = canonicaliseFigure(m[0].trim());
    if (value !== null) set.add(value);
  }
  return set;
}

export interface FaithfulnessVerdict {
  ok: boolean;
  /** Figures in the output with no counterpart in the source. */
  invented: ExtractedFigure[];
  /** Phrased so it can be handed back to the model verbatim. */
  reason: string;
  checked: number;
}

/**
 * Check enriched text against its source.
 *
 * `enriched` is every string the blocks will print, joined. The caller builds it
 * with `enrich.pure.ts › enrichedText`, which walks the block union in one
 * place, rather than this module re-walking it — a tenth block kind should not
 * be able to escape the check by being forgotten in a second file.
 */
export function checkFaithful(sourceMarkdown: string, enriched: string): FaithfulnessVerdict {
  const source = figureSet(sourceMarkdown);
  const figures = extractFigures(enriched);
  const invented = figures.filter((f) => !source.has(f.value));

  if (!invented.length) {
    return { ok: true, invented: [], reason: '', checked: figures.length };
  }

  const named = invented.slice(0, 6).map((f) => f.token).join(', ');
  const more = invented.length > 6 ? ` and ${invented.length - 6} more` : '';
  return {
    ok: false,
    invented,
    reason: `it contains ${invented.length} figure${invented.length === 1 ? '' : 's'} `
      + `the chapter does not: ${named}${more}`,
    checked: figures.length,
  };
}
