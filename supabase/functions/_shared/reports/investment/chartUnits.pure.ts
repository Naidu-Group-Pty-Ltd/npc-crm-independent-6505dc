/**
 * A shared axis is a claim that the quantities on it are comparable.
 *
 * ## What two pages of the 97 Poole Road Compass drew
 *
 * Page 13, under the heading *Local accessibility snapshot*:
 *
 * ```
 * Walk to school   ███████████████████████████████████████  99.1%
 * Walk to a park   ███████████████████████████████████████  100%
 * Metro station    ▎                                        ~2.1 km
 * ```
 *
 * Page 28, under *Development pipeline*:
 *
 * ```
 * New dwellings            ▏                                241
 * Stated development cost  ███████████████████████████████  $163,527,942
 * ```
 *
 * Both are correct arithmetic and both are nonsense. A bar's length is the
 * only thing a bar chart says, and it says it by putting every value on one
 * track — so 2.1 kilometres drawn against a 100 per cent axis is a two per
 * cent sliver that means nothing, and 241 dwellings drawn against 163 million
 * dollars is a hairline. A reader takes "short bar" as "small quantity",
 * because that is the only reading the form admits.
 *
 * `chartScale.pure.ts` already keeps ONE scale per unit ACROSS a document.
 * This is the defect one level down: more than one unit inside a single chart,
 * where no choice of maximum can help.
 *
 * ## The rule
 *
 * **A chart of more than one unit is not drawn — it is set as the table its
 * data already is.** Not dropped: every label, every value and their order
 * survive, and the title becomes the table's caption. The rule the repository
 * already pays for elsewhere — a promise of a figure is a figure, so a
 * directive the presentation cannot honour is tabulated rather than deleted
 * behind the sentence that introduced it.
 *
 * Three things it deliberately does not do.
 *
 * **It does not guess a unit it cannot read.** An item whose value carries no
 * unit marker is `count`, which is what a bare number is; an item the parser
 * refused has no value to compare and is passed over rather than counted as a
 * unit of its own. A chart nothing can be read from is left exactly as it was.
 *
 * **It does not unify.** Converting kilometres to metres so the axis agrees
 * would be inventing a comparison the writer did not make.
 *
 * **It never touches a single-unit chart**, which is every chart in a document
 * that was already right — so this is a no-op on all of them, byte for byte.
 */
import { VIZ_DIRECTIVE_RE_G, parseVizDirective } from '../vizDirectives.pure.ts';

/** The kinds whose items share one track, and so must share one unit. */
const SHARED_AXIS_KINDS = new Set(['bars', 'columns']);

/**
 * The unit a printed value carries.
 *
 * Read from the DISPLAY string the model wrote, never from the parsed number:
 * `2.1` and `2.1 km` are the same number and different quantities, and the
 * display is the only place that difference survives.
 */
export function unitOf(display: string | undefined): string {
  const s = (display ?? '').trim();
  if (!s) return 'count';
  if (/%\s*$/u.test(s)) return 'percent';
  if (/^[~≈<>]?\s*[-+]?\s*[$€£]/u.test(s)) return 'money';
  // A trailing alphabetic run is the unit: `km`, `m²`, `min`, `pa`, `ha`.
  // The magnitude suffixes are part of the NUMBER (`$1.2M`, `45k`), so a
  // single k/m/b after digits is not a unit.
  const tail = /([a-zA-Z²³µ°]+)\s*$/u.exec(s);
  if (!tail) return 'count';
  const word = tail[1];
  if (/^[kKmMbB]$/u.test(word)) return 'count';
  return word.toLowerCase();
}

export interface MixedUnitChart {
  /** The directive's kind, as written. */
  readonly kind: string;
  /** The units found on it, in the order they first appeared. */
  readonly units: readonly string[];
  /** Its title, where it had one. */
  readonly title?: string;
}

export interface MixedUnitResult {
  readonly markdown: string;
  /** One entry per chart that was set as a table instead of drawn. */
  readonly tabulated: readonly MixedUnitChart[];
}

/** Escape a cell so a value carrying a pipe cannot break the table. */
const cell = (s: string) => s.replace(/\|/gu, '\\|').trim();

/**
 * Set a mixed-unit chart as a table.
 *
 * The title leads as a bold line rather than a heading, because a heading
 * would enter the document's own outline and change its contents page — and
 * this is a presentation repair, not a restructuring.
 */
function tabulate(
  title: string | undefined,
  rows: ReadonlyArray<{ label: string; display: string }>,
): string {
  const head = title ? `**${cell(title)}**\n\n` : '';
  return `${head}| Item | Value |\n| --- | --- |\n`
    + rows.map((r) => `| ${cell(r.label)} | ${cell(r.display)} |`).join('\n');
}

/**
 * Find every shared-axis chart carrying more than one unit and set it as a
 * table.
 *
 * Returns the source unchanged, and an empty list, for a document in which
 * every chart plots one quantity.
 */
export function tabulateMixedUnitCharts(markdown: string): MixedUnitResult {
  if (!markdown) return { markdown: '', tabulated: [] };
  const tabulated: MixedUnitChart[] = [];

  const out = markdown.replace(VIZ_DIRECTIVE_RE_G, (whole, kind: string, body: string) => {
    if (!SHARED_AXIS_KINDS.has(String(kind).toLowerCase())) return whole;
    const d = parseVizDirective(kind, body);
    if (!d || d.kind !== 'bars') return whole;
    // An item the parser refused carries no value to compare, so it cannot
    // make a chart mixed. A chart of nothing but refusals is left alone —
    // `renderVizDirective` already has a reading for that one.
    const items = d.items ?? [];
    if (items.length < 2) return whole;

    const units: string[] = [];
    for (const it of items) {
      const u = unitOf(it.display);
      if (!units.includes(u)) units.push(u);
    }
    if (units.length < 2) return whole;

    tabulated.push({ kind: String(kind).toLowerCase(), units, title: d.title });
    // `display` is what the model printed beside the bar; falling back to the
    // parsed number keeps a row that would otherwise print blank.
    return tabulate(d.title, items.map((it) => ({
      label: it.label,
      display: it.display ?? String(it.value),
    })));
  });

  return { markdown: tabulated.length ? out : markdown, tabulated };
}
