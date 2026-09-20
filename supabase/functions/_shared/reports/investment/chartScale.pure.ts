/**
 * One scale per quantity per document.
 *
 * ── The defect this closes ───────────────────────────────────────────────
 *
 * The Investment Compass for 48 Redfern Street draws the distance to the Cowra
 * CBD twice, two pages apart:
 *
 *   page 12  `{{bars: Core CBD & shops 1.6 km, … | max=3 | unit=km}}`
 *   page 13  `{{bars: … Cowra CBD ~1.6 km, …    | max=5 | unit=km}}`
 *
 * 1.6 of 3 is a bar 53% of the track. 1.6 of 5 is a bar 32% of it. The same
 * distance to the same place is drawn 21 points shorter on the next page, and
 * nothing in the pipeline compared the two — each directive declares its own
 * maximum and the renderer obeys whichever one it is handed.
 *
 * ── The rule ────────────────────────────────────────────────────────────
 *
 * A quantity is identified by its UNIT, because that is what a reader compares
 * on. Every chart in one document that plots the same unit is drawn against
 * one maximum, chosen as the largest a member needs, rounded up to a figure a
 * person would choose for an axis. A chart that is alone in its unit keeps
 * exactly the maximum it declared, so a document with one distance chart is
 * byte-identical.
 *
 * Three things it deliberately does not do.
 *
 * **It never changes a value.** Only the axis moves; every printed figure is
 * the one the model wrote.
 *
 * **It does not unify a RATING with a measurement.** `max=100` with no unit is
 * a scorecard, and those are judged by `chartEvidence`, not rescaled to agree
 * with each other — making two invented scales consistent makes them look
 * measured.
 *
 * **It does not unify across units.** Kilometres and minutes are both
 * "distance to the shops" in prose and are different quantities on a page.
 *
 * Deno-compatible: siblings only, explicit `.ts` extensions.
 */
import { VIZ_DIRECTIVE_RE, parseVizDirective } from '../vizDirectives.pure.ts';

/** Axis maxima a person would choose, in the order a scale grows. */
const NICE_STEPS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50, 60, 80, 100];

/**
 * The smallest readable maximum that still contains `v`.
 *
 * Rounded to three decimals on the way out because `3 * 0.1 * 10` is
 * 3.0000000000000004 in binary floating point, and that would print into a
 * directive as the axis maximum — a defect a reader would see.
 */
export function niceMax(v: number): number {
  if (!(v > 0)) return 1;
  const tidy = (n: number) => Math.round(n * 1000) / 1000;
  const mag = Math.pow(10, Math.floor(Math.log10(v)) - 1);
  for (const step of NICE_STEPS) {
    const candidate = tidy(step * mag * 10);
    if (candidate >= v) return candidate;
  }
  return tidy(Math.ceil(v / (mag * 10)) * mag * 10);
}

export interface ScaleAlignment {
  markdown: string;
  /** One entry per unit that was shared, with the maximum every chart now uses. */
  aligned: Array<{ unit: string; max: number; charts: number; wasDeclared: number[] }>;
}

/** A unit that identifies a comparable quantity. A rating declares none. */
function comparableUnit(unit: string | undefined): string | null {
  const u = String(unit ?? '').trim().toLowerCase();
  if (!u) return null;
  // `%` and `/10` are scales, not units: two per-cent charts of different
  // populations share a maximum of 100 for reasons that have nothing to do
  // with comparability, and `/10` is a rating wearing a unit.
  if (u === '%' || u.startsWith('/')) return null;
  return u;
}

/**
 * Draw every chart of one quantity against one axis.
 *
 * Applied to a whole document, because that is the span over which a reader
 * compares two bars — a section boundary is not a licence to change a scale.
 */
export function alignChartScales(markdown: string): ScaleAlignment {
  const lines = markdown.split('\n');
  const byUnit = new Map<string, { needed: number; declared: number[]; lines: number[] }>();

  lines.forEach((line, i) => {
    const t = line.trim();
    if (!t.startsWith('{{')) return;
    // The NON-global pattern, deliberately.
    //
    // `VIZ_DIRECTIVE_RE_G` is a module-level `g` regex, so `exec` against it
    // leaves `lastIndex` wherever the match ended — and `String.matchAll`
    // copies `lastIndex` onto the regex it clones. A single `exec` here made
    // `parseVizDirectives` skip the first directive of the next document it
    // scanned, which is how a shared global regex quietly loses a chart.
    const m = VIZ_DIRECTIVE_RE.exec(t);
    if (!m) return;
    const d = parseVizDirective(m[1], m[2] ?? '');
    if (!d || d.kind !== 'bars') return;
    const unit = comparableUnit(d.unit);
    if (!unit || d.max === undefined) return;
    const peak = d.items.reduce((hi, it) => Math.max(hi, Math.abs(it.value)), 0);
    const entry = byUnit.get(unit) ?? { needed: 0, declared: [], lines: [] };
    entry.needed = Math.max(entry.needed, peak);
    entry.declared.push(d.max);
    entry.lines.push(i);
    byUnit.set(unit, entry);
  });

  const aligned: ScaleAlignment['aligned'] = [];
  const rewrite = new Map<number, number>();
  for (const [unit, e] of byUnit) {
    // One chart in its unit: nothing to reconcile, and changing it would be a
    // taste judgement rather than a correction.
    if (e.lines.length < 2) continue;
    const distinct = new Set(e.declared);
    if (distinct.size === 1) continue;
    // The largest declared maximum is respected where it already contains the
    // data — an author who chose 5 for a chart peaking at 3 left headroom on
    // purpose, and the fix is agreement, not the tightest possible axis.
    const max = Math.max(niceMax(e.needed), ...e.declared);
    for (const i of e.lines) rewrite.set(i, max);
    aligned.push({ unit, max, charts: e.lines.length, wasDeclared: e.declared });
  }
  if (!rewrite.size) return { markdown, aligned };

  const out = lines.map((line, i) => {
    const max = rewrite.get(i);
    if (max === undefined) return line;
    return line.replace(/\bmax\s*=\s*[0-9.]+/, `max=${max}`);
  });
  return { markdown: out.join('\n'), aligned };
}
